import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { withTenant, recordEvent, type Tx } from '@/db';
import {
  accessPolicies, accessEscalations, verificationChallenges, staffVouches,
} from '@/db/schema/access';
import { ConflictError, ForbiddenError, TooManyAttemptsError, ValidationError } from '@/lib/errors';
import { hashToken } from '@/lib/tokens';
import { raiseSessionTier, type GuestSession } from './guest-sessions';
import { tierAtLeast, tierForAction, type AccessTier, type GuestAction } from './tiers';

/**
 * Escalation. D-012 — the ONE verification prompt in the product.
 *
 * The central behaviour, and the thing most likely to be got wrong:
 * **an insufficient tier does not 403. It escalates.** A 403 tells the guest
 * they are not allowed; escalation asks them one question and then lets them
 * through. The difference is the entire adoption argument.
 */

export interface EscalationRequired {
  required: true;
  fromTier: AccessTier;
  toTier: AccessTier;
  methods: readonly ('PHONE_LAST4' | 'OTP_SMS')[];
  escalationId: string;
}

export type TierCheck = { required: false } | EscalationRequired;

/**
 * The guard future ordering code calls. Returns rather than throws, because
 * "you need to verify" is a normal branch of the happy path, not an error.
 */
export async function requireTier(
  session: GuestSession,
  action: GuestAction,
): Promise<TierCheck> {
  const needed = tierForAction(action);
  if (tierAtLeast(session.accessTier, needed)) return { required: false };

  return withTenant({ tenantId: session.tenantId, propertyId: session.propertyId }, async (tx) => {
    const policy = await tx.select({
      allowPhoneLast4: accessPolicies.allowPhoneLast4,
      allowOtpSms: accessPolicies.allowOtpSms,
    }).from(accessPolicies)
      .where(eq(accessPolicies.propertyId, session.propertyId))
      .limit(1);

    const methods: ('PHONE_LAST4' | 'OTP_SMS')[] = [];
    if (policy[0]?.allowPhoneLast4 ?? true) methods.push('PHONE_LAST4');
    if (policy[0]?.allowOtpSms ?? true) methods.push('OTP_SMS');

    // Abandonment is recorded as much as success — a guest who backs out at the
    // prompt is the signal that escalation_trigger is set too aggressively.
    const [row] = await tx.insert(accessEscalations).values({
      tenantId: session.tenantId,
      propertyId: session.propertyId,
      guestSessionId: session.id,
      fromTier: session.accessTier,
      toTier: needed,
      triggeredBy: action,
      outcome: 'STARTED',
    }).returning({ id: accessEscalations.id });

    return {
      required: true as const,
      fromTier: session.accessTier,
      toTier: needed,
      methods,
      escalationId: row!.id,
    };
  });
}

/** Marks an escalation abandoned — the guest saw the prompt and left. */
export async function abandonEscalation(session: GuestSession, escalationId: string): Promise<void> {
  await withTenant({ tenantId: session.tenantId }, (tx) =>
    tx.update(accessEscalations)
      .set({ outcome: 'ABANDONED', abandonedAt: new Date() })
      .where(eq(accessEscalations.id, escalationId)));
}

/**
 * The property's access policy, or the defaults.
 *
 * One read, because three separate call sites reading three columns each is how
 * `max_attempts_per_phone` and `allow_staff_vouch` came to sit in this table
 * unread while the code used the schema's own column defaults instead. A policy
 * nobody reads is a setting that lies.
 */
async function policyFor(
  tx: Tx,
  propertyId: string,
): Promise<{
  maxPerRoom: number;
  maxPerPhone: number;
  lockoutMinutes: number;
  allowStaffVouch: boolean;
}> {
  const rows = await tx.select({
    maxPerRoom: accessPolicies.maxAttemptsPerRoom,
    maxPerPhone: accessPolicies.maxAttemptsPerPhone,
    lockoutMinutes: accessPolicies.lockoutMinutes,
    allowStaffVouch: accessPolicies.allowStaffVouch,
  }).from(accessPolicies).where(eq(accessPolicies.propertyId, propertyId)).limit(1);

  const policy = rows[0];
  return {
    maxPerRoom: policy?.maxPerRoom ?? 5,
    maxPerPhone: policy?.maxPerPhone ?? 5,
    lockoutMinutes: policy?.lockoutMinutes ?? 30,
    // A property with no policy row can still be vouched for: the front desk
    // standing in front of the guest is the fallback, not the thing to disable
    // by omission.
    allowStaffVouch: policy?.allowStaffVouch ?? true,
  };
}

async function assertNotLockedOut(tx: Tx, session: GuestSession): Promise<void> {
  const { maxPerRoom, lockoutMinutes } = await policyFor(tx, session.propertyId);

  const recent = await tx.select({
    attempts: verificationChallenges.attempts,
    lockedUntil: verificationChallenges.lockedUntil,
  }).from(verificationChallenges)
    .where(and(
      eq(verificationChallenges.roomId, session.roomId),
      gt(verificationChallenges.createdAt, new Date(Date.now() - lockoutMinutes * 60_000)),
    ))
    .orderBy(desc(verificationChallenges.createdAt));

  const locked = recent.find((r) => r.lockedUntil && r.lockedUntil > new Date());
  if (locked) {
    throw new TooManyAttemptsError(
      Math.ceil((locked.lockedUntil!.getTime() - Date.now()) / 1000),
    );
  }

  // Without this, last-4 verification is a five-attempt brute force
  // (DATA-MODEL §3). Counted per ROOM, across challenges, not per challenge —
  // otherwise starting a new challenge resets the counter.
  const total = recent.reduce((n, r) => n + r.attempts, 0);
  if (total >= maxPerRoom) {
    throw new TooManyAttemptsError(lockoutMinutes * 60);
  }
}

/**
 * Start a PHONE_LAST4 challenge. The stored value is a hash: the last four
 * digits of a phone number are low entropy, and a leaked table of them across
 * a hotel is a plausible attack on its own.
 */
export async function startPhoneLast4Challenge(session: GuestSession): Promise<string> {
  return withTenant({ tenantId: session.tenantId, propertyId: session.propertyId }, async (tx) => {
    await assertNotLockedOut(tx, session);

    const guestPhone = await tx.execute<{ phone: string | null }>(sql`
      SELECT g.phone FROM stays s JOIN guests g ON g.id = s.guest_id
      WHERE s.id = ${session.stayId} LIMIT 1
    `);
    const phone = guestPhone.rows[0]?.phone;
    if (!phone) {
      // Nothing to verify against. Front desk vouching is the way through.
      throw new ConflictError(
        'We do not have a phone number on file for this room. Ask the front desk to confirm it for you.',
      );
    }

    const last4 = phone.replace(/\D/g, '').slice(-4);
    // From the POLICY, not from the column's own default. Both are 5 today,
    // which is exactly why nobody noticed the policy was being ignored: a
    // property that set 3 got 5.
    const { maxPerPhone } = await policyFor(tx, session.propertyId);

    const [row] = await tx.insert(verificationChallenges).values({
      tenantId: session.tenantId,
      propertyId: session.propertyId,
      stayId: session.stayId,
      roomId: session.roomId,
      method: 'PHONE_LAST4',
      challengeHash: hashToken(last4),
      phoneLast4: null, // never stored in the clear
      maxAttempts: maxPerPhone,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    }).returning({ id: verificationChallenges.id });

    return row!.id;
  });
}

/**
 * Answer a challenge. On success the tier is raised on the EXISTING session
 * (D-012) — a second session would orphan whatever the guest was doing.
 */
export async function answerChallenge(
  session: GuestSession,
  challengeId: string,
  answer: string,
  escalationId?: string,
): Promise<{ ok: boolean; newTier?: AccessTier; attemptsLeft?: number }> {
  if (!answer.trim()) throw new ValidationError('Enter the last four digits.');

  /**
   * ─── Why this returns an outcome instead of throwing inside the transaction ─
   *
   * The lockout is a WRITE. Throwing `TooManyAttemptsError` from inside
   * `withTenant()` rolls that write back with everything else, so the attempt
   * that crossed the limit recorded neither the attempt nor the lockout — the
   * rate limiter announced a lockout it had just discarded. It looked correct
   * from the outside because the error still reached the guest.
   *
   * So the transaction decides and COMMITS, and the throw happens after it.
   */

  const outcome = await withTenant(
    { tenantId: session.tenantId, propertyId: session.propertyId },
    async (tx) => {
    // Throws before anything is written, so there is nothing to lose here.
    await assertNotLockedOut(tx, session);

    const rows = await tx.select({
      id: verificationChallenges.id,
      challengeHash: verificationChallenges.challengeHash,
      attempts: verificationChallenges.attempts,
      maxAttempts: verificationChallenges.maxAttempts,
      succeededAt: verificationChallenges.succeededAt,
      expiresAt: verificationChallenges.expiresAt,
    }).from(verificationChallenges)
      .where(and(
        eq(verificationChallenges.id, challengeId),
        eq(verificationChallenges.stayId, session.stayId),
      ))
      .limit(1);

    const challenge = rows[0];
    if (!challenge) throw new ConflictError('That verification has expired. Start again.');
    if (challenge.succeededAt) throw new ConflictError('That verification was already used.');
    if (challenge.expiresAt <= new Date()) {
      throw new ConflictError('That verification has expired. Start again.');
    }

    const attempts = challenge.attempts + 1;
    const correct = challenge.challengeHash === hashToken(answer.replace(/\D/g, ''));

    if (!correct) {
      // From the POLICY. This was a hardcoded 30 minutes while
      // `access_policies.lockout_minutes` sat next to it being read by
      // `assertNotLockedOut()` only — so a property that set 10 was locked out
      // for 30 on this path and 10 on the other.
      const { lockoutMinutes } = await policyFor(tx, session.propertyId);
      const lockedUntil = attempts >= challenge.maxAttempts
        ? new Date(Date.now() + lockoutMinutes * 60_000)
        : null;
      await tx.update(verificationChallenges)
        .set({ attempts, lockedUntil })
        .where(eq(verificationChallenges.id, challenge.id));

      return lockedUntil
        ? { kind: 'LOCKED' as const, seconds: lockoutMinutes * 60 }
        : { kind: 'WRONG' as const, attemptsLeft: challenge.maxAttempts - attempts };
    }

    await tx.update(verificationChallenges)
      .set({ attempts, succeededAt: new Date() })
      .where(eq(verificationChallenges.id, challenge.id));

    const newTier: AccessTier = 'CHARGE';
    await raiseSessionTier(tx, session.id, newTier, { isAnonymous: false });

    if (escalationId) {
      await tx.update(accessEscalations)
        .set({ outcome: 'SUCCEEDED', method: 'PHONE_LAST4', completedAt: new Date() })
        .where(eq(accessEscalations.id, escalationId));
    }

    await recordEvent(tx, {
      tenantId: session.tenantId,
      propertyId: session.propertyId,
      entityType: 'guest_session',
      entityId: session.id,
      eventType: 'guest_session.escalated',
      fromStatus: session.accessTier,
      toStatus: newTier,
      actor: { kind: 'GUEST', guestSessionId: session.id },
      payload: { method: 'PHONE_LAST4' },
    });

    return { kind: 'OK' as const, newTier };
  },
  );

  // Outside the transaction, which has committed by now: the lockout it wrote
  // survives the error this raises.
  if (outcome.kind === 'LOCKED') throw new TooManyAttemptsError(outcome.seconds);
  if (outcome.kind === 'WRONG') return { ok: false, attemptsLeft: outcome.attemptsLeft };
  return { ok: true, newTier: outcome.newTier };
}

/**
 * Front desk vouching. D-012 — the guest sees NO prompt at all.
 *
 * This is the deliberate bypass of the product's only anti-fraud control, which
 * is why it needs `guest:vouch` (its own permission, not folded into
 * guest:update) and why it writes both a vouch row and an event.
 */
export async function vouchForGuest(input: {
  tenantId: string;
  propertyId: string;
  stayId: string;
  staffUserId: string;
  guestSessionId?: string;
  grantedTier?: AccessTier;
  reason?: string;
}): Promise<void> {
  const grantedTier = input.grantedTier ?? 'CHARGE';

  await withTenant({ tenantId: input.tenantId, propertyId: input.propertyId }, async (tx) => {
    // `allow_staff_vouch` exists so a property CAN turn this off — a group with
    // a strict finance policy may want the prompt and nothing else. It sat
    // unread until a sweep found it, which made the setting decorative.
    const { allowStaffVouch } = await policyFor(tx, input.propertyId);
    if (!allowStaffVouch) {
      throw new ForbiddenError(
        'This property does not allow staff to vouch for a guest. They must verify on their phone.',
      );
    }

    await tx.insert(staffVouches).values({
      tenantId: input.tenantId,
      propertyId: input.propertyId,
      stayId: input.stayId,
      guestSessionId: input.guestSessionId ?? null,
      staffUserId: input.staffUserId,
      grantedTier,
      reason: input.reason ?? null,
    });

    // Raise every live session for the stay — the guest may have scanned from
    // two devices, and being vouched for on one is being vouched for.
    await tx.execute(sql`
      UPDATE guest_sessions
      SET access_tier = ${grantedTier}, is_anonymous = false
      WHERE stay_id = ${input.stayId} AND revoked_at IS NULL AND expires_at > now()
    `);

    await recordEvent(tx, {
      tenantId: input.tenantId,
      propertyId: input.propertyId,
      entityType: 'stay',
      entityId: input.stayId,
      eventType: 'guest_session.vouched',
      toStatus: grantedTier,
      actor: { kind: 'STAFF', staffUserId: input.staffUserId },
      payload: { reason: input.reason ?? null },
    });
  });
}
