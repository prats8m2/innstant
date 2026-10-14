import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import { withTenant, recordEvent, type Tx } from '@/db';
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
export async function requestCode(input: RequestCodeInput): Promise<void> {
  const phone = normalisePhone(input.phone);
  if (!isDialable(phone)) {
    throw new ValidationError('That phone number does not look right.');
  }

  const sender = otpSender();
  assertSenderIsSafeFor(sender, process.env.NODE_ENV);

  /**
   * ─── The transaction decides and commits; the SMS is sent after it ───────
   *
   * Two reasons, and the second is D-038's rule.
   *
   * A send inside the transaction holds it open for a network round trip to a
   * provider — 200ms+ of a row lock, per sign-in, at the mercy of somebody
   * else's uptime. "A remote system cannot be inside our transaction" is
   * exactly what the PMS outbox exists to avoid.
   *
   * And the failure modes are not symmetric. Committing then failing to send
   * leaves a challenge nobody can answer, which costs one retry. Sending then
   * rolling back leaves a code in somebody's hand that verifies against
   * nothing, which is unrecoverable and looks like the product is broken.
   */
  const hourAgo = new Date(Date.now() - 60 * 60_000);

  const code = await withTenant({ tenantId: input.tenantId }, async (tx) => {
    // Two throttles. Per-phone stops somebody being texted repeatedly;
    // per-IP stops a list of 100,000 numbers being pumped one request each,
    // which no per-phone limit would ever see.
    const recent = await tx.select({ n: sql<number>`count(*)::int` })
      .from(otpChallenges)
      .where(and(
        eq(otpChallenges.tenantId, input.tenantId),
        eq(otpChallenges.phone, phone),
        gt(otpChallenges.createdAt, hourAgo),
      ));

    // Silently. Telling the caller they are throttled tells them the number
    // is one somebody has been asking about.
    if ((recent[0]?.n ?? 0) >= MAX_SENDS_PER_PHONE_HOUR) return null;

    if (input.ipAddress) {
      const fromIp = await tx.select({ n: sql<number>`count(*)::int` })
        .from(otpChallenges)
        .where(and(
          eq(otpChallenges.tenantId, input.tenantId),
          eq(otpChallenges.ipAddress, input.ipAddress),
          gt(otpChallenges.createdAt, hourAgo),
        ));
      if ((fromIp[0]?.n ?? 0) >= MAX_SENDS_PER_IP_HOUR) return null;
    }

    // At most one live code per number — the partial unique index in 0009
    // enforces it, and this is what keeps the insert below legal. Superseding
    // rather than consuming, so a verified challenge stays distinguishable
    // from an abandoned one in the audit trail.
    await tx.update(otpChallenges)
      .set({ supersededAt: new Date() })
      .where(and(
        eq(otpChallenges.tenantId, input.tenantId),
        eq(otpChallenges.phone, phone),
        isNull(otpChallenges.consumedAt),
        isNull(otpChallenges.supersededAt),
      ));

    const fresh = newCode();

    await tx.insert(otpChallenges).values({
      tenantId: input.tenantId,
      phone,
      codeHash: hashToken(fresh),
      maxAttempts: MAX_ATTEMPTS_PER_PHONE,
      expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    });

    return fresh;
  });

  // Throttled. The caller is told nothing, which is the point.
  if (!code) return;

  await sender.send({ phone, code, expiresInMinutes: CODE_TTL_MINUTES });
}

/**
 * What goes in `full_name` when somebody signs in without offering one.
 *
 * Named rather than inlined because two places have to agree on it: the row
 * is created with it, and the next sign-in recognises it as "no real name
 * here" and so is free to record the one it was just given.
 */
const NO_NAME_GIVEN = 'Guest';

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
/**
 * What the transaction decided. Never thrown from inside it.
 *
 * ─── Why this is an outcome and not an exception ───────────────────────────
 *
 * Because the attempt counter is a WRITE, and `withTenant()` rolls a
 * transaction back when something throws out of it. An earlier version of this
 * function incremented `attempts` and then threw "that code is not right" in
 * the same transaction — so the increment was discarded every single time, the
 * counter never moved off zero, and a six-digit code had **no brute-force
 * protection at all**. It looked perfect from the outside: the right error
 * reached the caller on every wrong guess.
 *
 * `answerChallenge()` in modules/access already carried this exact warning,
 * written after the same bug was found there. Finding it twice is the argument
 * for the shape both now share: **the transaction decides and COMMITS, and the
 * throw happens after it.**
 */
type VerifyOutcome =
  | { kind: 'OK'; issued: IssuedCustomerSession; guestId: string }
  | { kind: 'WRONG' }
  | { kind: 'LOCKED'; retryAfterSeconds: number };

export async function verifyCode(input: VerifyCodeInput): Promise<VerifiedCustomer> {
  const phone = normalisePhone(input.phone);

  const outcome = await withTenant({ tenantId: input.tenantId }, async (tx): Promise<VerifyOutcome> => {
    // Lockout counted per PHONE across challenges — see MAX_ATTEMPTS_PER_PHONE.
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
      return {
        kind: 'LOCKED',
        retryAfterSeconds: Math.ceil((locked.lockedUntil!.getTime() - Date.now()) / 1000),
      };
    }

    // A challenge that was successfully consumed is forgiven, the same way
    // `assertNotLockedOut` forgives a succeeded attempt: somebody who
    // eventually got in is not somebody under attack.
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
      return { kind: 'LOCKED', retryAfterSeconds: LOCKOUT_MINUTES * 60 };
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

    /**
     * Every miss costs an attempt, including "there is no challenge at all" —
     * which is why this increment comes before the three refusals below and
     * why all three return the SAME outcome. Distinguishing "no challenge"
     * from "wrong code" would make verify the oracle that `requestCode` is
     * carefully built not to be.
     */
    if (challenge) {
      await tx.update(otpChallenges)
        .set({ attempts: challenge.attempts + 1 })
        .where(eq(otpChallenges.id, challenge.id));
    }

    if (!challenge) return { kind: 'WRONG' };
    if (challenge.expiresAt <= new Date()) return { kind: 'WRONG' };
    if (hashToken(input.code.trim()) !== challenge.codeHash) return { kind: 'WRONG' };

    await tx.update(otpChallenges)
      .set({ consumedAt: new Date() })
      .where(eq(otpChallenges.id, challenge.id));

    /**
     * The guest row, found or made HERE — not at request.
     *
     * `(tenant_id, phone)` is unique (EXTENSION-POINTS §2), so somebody who
     * ordered anonymously with this number, or stayed at the hotel, resolves
     * to the row that already exists rather than to a second one. Their NAME
     * is untouched: `upsertGuestByPhone` refuses to write over it, and a
     * customer who wants a different one sets `display_name`.
     */
    const guestId = await upsertGuestByPhone(tx, {
      tenantId: input.tenantId,
      phone,
      fullName: input.name?.trim() || NO_NAME_GIVEN,
    });

    /**
     * The name they typed, when the row has no real one to protect.
     *
     * `upsertGuestByPhone()` leaves an existing `full_name` alone, which is
     * right — that column belongs to the front desk, and somebody who is
     * "Anjali Menon" on a folio has not renamed herself by typing "anj" into
     * a takeaway form.
     *
     * But a row this flow created itself, for a sign-in that offered no name,
     * holds the placeholder. Refusing the name on the NEXT sign-in left the
     * app calling somebody "Guest" back to them — on the account screen, on
     * the cart, and on the ticket the kitchen reads out — while the name they
     * had just typed was dropped on the floor. That is the bug this closes.
     *
     * It writes `display_name`, never `full_name`, and only when both are
     * absent. So the front desk's record is still untouched, and the sign-in
     * screen's promise — "it never changes a name a hotel already has for
     * you" — stays literally true.
     */
    const given = input.name?.trim();
    if (given) {
      await tx.execute(sql`
        UPDATE guests SET display_name = ${given}, updated_at = now()
        WHERE id = ${guestId}
          AND display_name IS NULL
          AND (full_name IS NULL OR full_name = ${NO_NAME_GIVEN})
      `);
    }

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

    return { kind: 'OK', issued, guestId };
  });

  // Committed. Now, and only now, is it safe to throw.
  if (outcome.kind === 'LOCKED') {
    throw new TooManyAttemptsError(
      outcome.retryAfterSeconds,
      'Too many tries. Wait a little and ask for a new code.',
    );
  }
  if (outcome.kind === 'WRONG') {
    throw new ValidationError('That code is not right. Check it and try again.');
  }

  return { ...outcome.issued, guestId: outcome.guestId };
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
