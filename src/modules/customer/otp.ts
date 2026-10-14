import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import { recordEvent, type Tx } from '@/db';
import { otpChallenges } from '@/db/schema/customer';
import { upsertGuestByPhone } from '@/modules/stay';
import { hashToken } from '@/lib/tokens';
import { normalisePhone, isDialable } from '@/lib/phone';
import { TooManyAttemptsError, ValidationError } from '@/lib/errors';
import { otpSender, assertSenderIsSafeFor } from './otp-sender';
import { issueCustomerSession, type IssuedCustomerSession } from './sessions';

/**
 * Phone sign-in. D-081.
 *
 * ─── The endpoint that creates a code must not be an oracle ────────────────
 *
 * Everything awkward about this file comes from one requirement: asking for a
 * code for a number that has never ordered here must be INDISTINGUISHABLE from
 * asking for one that has. Otherwise the endpoint answers "is this person a
 * customer of this hotel group", unauthenticated, at whatever rate it allows.
 *
 * So `requestCode()` does not touch `guests` at all. It writes a challenge for
 * any dialable number, and the guest row is created or found at VERIFY, once
 * the handset has actually been proved. That also removes an unauthenticated
 * write amplification — without it, anyone could create unbounded `guests`
 * rows for arbitrary numbers.
 *
 * The response is one fixed success for every dialable number. A throttled
 * number gets it too and simply is not sent to.
 */

const CODE_LENGTH = 6;
const CODE_TTL_MINUTES = 10;

/**
 * Lockout is per PHONE, across challenges — not per challenge row.
 *
 * `escalation.ts` solved this exact problem one table over and wrote down
 * why: counting per challenge means starting a new one resets the counter, so
 * request → five wrong → request again → five more. Two hundred requests is a
 * thousand guesses against a six-digit code, which is every code.
 */
const MAX_ATTEMPTS_PER_PHONE = 5;
const LOCKOUT_MINUTES = 30;

/** How many codes one number may be sent in an hour, and one IP. */
const MAX_SENDS_PER_PHONE_HOUR = 5;
const MAX_SENDS_PER_IP_HOUR = 20;

/** A code is six digits from a CSPRNG. `Math.random()` is not one, and this
 *  is the only secret standing between a phone number and an account. */
function newCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
}

export interface RequestCodeInput {
  tenantId: string;
  phone: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Send a code. Returns nothing a caller could leak.
 *
 * Specifically it does not say whether a code was actually sent — a throttled
 * number returns exactly as a fresh one does. The only distinguishable outcome
 * is a number that cannot be dialled at all, which is a property of the string
 * the caller typed and not of our data.
 */
export async function requestCode(tx: Tx, input: RequestCodeInput): Promise<void> {
  const phone = normalisePhone(input.phone);
  if (!isDialable(phone)) {
    throw new ValidationError('That phone number does not look right.');
  }

  const sender = otpSender();
  assertSenderIsSafeFor(sender, process.env.NODE_ENV);

  const hourAgo = new Date(Date.now() - 60 * 60_000);

  // Two throttles. Per-phone stops somebody being texted repeatedly; per-IP
  // stops a list of 100,000 numbers being pumped one request each, which no
  // per-phone limit would ever see.
  const recent = await tx.select({ n: sql<number>`count(*)::int` })
    .from(otpChallenges)
    .where(and(
      eq(otpChallenges.tenantId, input.tenantId),
      eq(otpChallenges.phone, phone),
      gt(otpChallenges.createdAt, hourAgo),
    ));

  if ((recent[0]?.n ?? 0) >= MAX_SENDS_PER_PHONE_HOUR) {
    // Silently. Telling the caller they are throttled tells them the number
    // is one somebody has been asking about.
    return;
  }

  if (input.ipAddress) {
    const fromIp = await tx.select({ n: sql<number>`count(*)::int` })
      .from(otpChallenges)
      .where(and(
        eq(otpChallenges.tenantId, input.tenantId),
        eq(otpChallenges.ipAddress, input.ipAddress),
        gt(otpChallenges.createdAt, hourAgo),
      ));
    if ((fromIp[0]?.n ?? 0) >= MAX_SENDS_PER_IP_HOUR) return;
  }

  // At most one live code per number — the partial unique index in 0009
  // enforces it, and this is what keeps that insert legal. Superseding rather
  // than consuming, so a verified challenge stays distinguishable from an
  // abandoned one in the audit trail.
  await tx.update(otpChallenges)
    .set({ supersededAt: new Date() })
    .where(and(
      eq(otpChallenges.tenantId, input.tenantId),
      eq(otpChallenges.phone, phone),
      isNull(otpChallenges.consumedAt),
      isNull(otpChallenges.supersededAt),
    ));

  const code = newCode();

  await tx.insert(otpChallenges).values({
    tenantId: input.tenantId,
    phone,
    codeHash: hashToken(code),
    maxAttempts: MAX_ATTEMPTS_PER_PHONE,
    expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  });

  await sender.send({ phone, code, expiresInMinutes: CODE_TTL_MINUTES });
}

export interface VerifyCodeInput {
  tenantId: string;
  phone: string;
  code: string;
  /** Used only if a guest row has to be created. Never overwrites an existing
   *  `full_name` — that column belongs to the front desk. */
  name?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface VerifiedCustomer extends IssuedCustomerSession {
  guestId: string;
}

/**
 * Check a code and issue a session.
 *
 * ─── Three failures, one answer ────────────────────────────────────────────
 *
 * "No such challenge", "expired" and "wrong code" are ONE message, and all
 * three consume an attempt. Distinguishing them would make verify the oracle
 * that request was carefully built not to be: an attacker who can tell
 * "no challenge" from "wrong code" learns which numbers have been asked about.
 */
export async function verifyCode(tx: Tx, input: VerifyCodeInput): Promise<VerifiedCustomer> {
  const phone = normalisePhone(input.phone);
  const wrong = () => new ValidationError('That code is not right. Check it and try again.');

  // Lockout counted per PHONE across challenges — see the note on
  // MAX_ATTEMPTS_PER_PHONE.
  const since = new Date(Date.now() - LOCKOUT_MINUTES * 60_000);
  const recent = await tx.select({
    attempts: otpChallenges.attempts,
    lockedUntil: otpChallenges.lockedUntil,
    consumedAt: otpChallenges.consumedAt,
  }).from(otpChallenges)
    .where(and(
      eq(otpChallenges.tenantId, input.tenantId),
      eq(otpChallenges.phone, phone),
      gt(otpChallenges.createdAt, since),
    ));

  const locked = recent.find((r) => r.lockedUntil && r.lockedUntil > new Date());
  if (locked) {
    throw new TooManyAttemptsError(
      Math.ceil((locked.lockedUntil!.getTime() - Date.now()) / 1000),
      'Too many tries. Wait a little and ask for a new code.',
    );
  }

  // A successful verify forgives what came before it, the same way
  // `assertNotLockedOut` does: somebody who eventually got in is not somebody
  // under attack.
  const spent = recent
    .filter((r) => !r.consumedAt)
    .reduce((sum, r) => sum + r.attempts, 0);

  if (spent >= MAX_ATTEMPTS_PER_PHONE) {
    const until = new Date(Date.now() + LOCKOUT_MINUTES * 60_000);
    await tx.update(otpChallenges)
      .set({ lockedUntil: until })
      .where(and(
        eq(otpChallenges.tenantId, input.tenantId),
        eq(otpChallenges.phone, phone),
        isNull(otpChallenges.consumedAt),
      ));
    throw new TooManyAttemptsError(LOCKOUT_MINUTES * 60, 'Too many tries. Wait a little and ask for a new code.');
  }

  const live = await tx.select().from(otpChallenges)
    .where(and(
      eq(otpChallenges.tenantId, input.tenantId),
      eq(otpChallenges.phone, phone),
      isNull(otpChallenges.consumedAt),
      isNull(otpChallenges.supersededAt),
    ))
    .orderBy(desc(otpChallenges.createdAt))
    .limit(1);

  const challenge = live[0];

  // Every miss costs an attempt, including "there is no challenge" — which is
  // why the increment happens before any of the three refusals.
  if (challenge) {
    await tx.update(otpChallenges)
      .set({ attempts: challenge.attempts + 1 })
      .where(eq(otpChallenges.id, challenge.id));
  }

  if (!challenge) throw wrong();
  if (challenge.expiresAt <= new Date()) throw wrong();
  if (hashToken(input.code.trim()) !== challenge.codeHash) throw wrong();

  await tx.update(otpChallenges)
    .set({ consumedAt: new Date() })
    .where(eq(otpChallenges.id, challenge.id));

  /**
   * The guest row, found or made HERE — not at request.
   *
   * `(tenant_id, phone)` is unique (EXTENSION-POINTS §2), so somebody who
   * ordered anonymously with this number, or stayed at the hotel, resolves to
   * the row that already exists rather than to a second one. Their NAME is
   * untouched: `upsertGuestByPhone` refuses to write over it, and a customer
   * who wants a different one sets `display_name` through the profile.
   */
  const guestId = await upsertGuestByPhone(tx, {
    tenantId: input.tenantId,
    phone,
    fullName: input.name?.trim() || 'Guest',
  });

  await markPhoneVerified(tx, guestId);

  const issued = await issueCustomerSession(tx, {
    tenantId: input.tenantId,
    guestId,
    method: 'OTP_SMS',
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  });

  await recordEvent(tx, {
    tenantId: input.tenantId,
    entityType: 'guest',
    entityId: guestId,
    eventType: 'customer.phone_verified',
    actor: { kind: 'CUSTOMER', guestId },
    // No phone number in the payload. `event_log` is read by staff screens;
    // the number lives on the guest row, which is where it belongs.
    payload: { method: 'OTP_SMS' },
  });

  return { ...issued, guestId };
}

/**
 * Raw SQL because `guests` is `modules/stay`'s table and D-001 forbids
 * importing it here. A one-column update inside the tenant-scoped transaction
 * is the narrow exception the codebase already makes elsewhere, and RLS still
 * applies to the row it touches.
 */
async function markPhoneVerified(tx: Tx, guestId: string): Promise<void> {
  await tx.execute(sql`
    UPDATE guests SET phone_verified_at = now(), updated_at = now()
    WHERE id = ${guestId} AND phone_verified_at IS NULL
  `);
}
