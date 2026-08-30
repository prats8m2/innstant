import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { withTenant, recordEvent, type Tx } from '@/db';
import {
  accessPolicies, accessEscalations, verificationChallenges, staffVouches,
} from '@/db/schema/access';
import { ConflictError, TooManyAttemptsError, ValidationError } from '@/lib/errors';
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

async function assertNotLockedOut(tx: Tx, session: GuestSession): Promise<void> {
  const policy = await tx.select({
    maxPerRoom: accessPolicies.maxAttemptsPerRoom,
    lockoutMinutes: accessPolicies.lockoutMinutes,
  }).from(accessPolicies).where(eq(accessPolicies.propertyId, session.propertyId)).limit(1);

  const maxPerRoom = policy[0]?.maxPerRoom ?? 5;
  const lockoutMinutes = policy[0]?.lockoutMinutes ?? 30;

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
    const [row] = await tx.insert(verificationChallenges).values({
      tenantId: session.tenantId,
      propertyId: session.propertyId,
      stayId: session.stayId,
      roomId: session.roomId,
      method: 'PHONE_LAST4',
      challengeHash: hashToken(last4),
      phoneLast4: null, // never stored in the clear
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

  return withTenant({ tenantId: session.tenantId, propertyId: session.propertyId }, async (tx) => {
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
      const lockedUntil = attempts >= challenge.maxAttempts
        ? new Date(Date.now() + 30 * 60_000)
        : null;
      await tx.update(verificationChallenges)
        .set({ attempts, lockedUntil })
        .where(eq(verificationChallenges.id, challenge.id));

      if (lockedUntil) throw new TooManyAttemptsError(30 * 60);
      return { ok: false, attemptsLeft: challenge.maxAttempts - attempts };
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

    return { ok: true, newTier };
  });
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
