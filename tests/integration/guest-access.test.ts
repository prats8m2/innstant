import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenant, closePool } from '@/db';
import {
  scanQrCode, resolveGuestSession, revokeSessionsForStay, requireTier,
  startPhoneLast4Challenge, answerChallenge, vouchForGuest, QrNotUsableError,
} from '@/modules/access';
import { ForbiddenError, TooManyAttemptsError } from '@/lib/errors';
import { ownerClient, seedTenant, cleanup, TENANT_A, type Fixture } from './setup';

/**
 * S7 — D-012 proven, not assumed.
 *
 * The done condition: "you can scan a seeded QR on your phone, see the property
 * home with no screen in the way, and the session row shows isAnonymous: true,
 * accessTier: REQUEST."
 */
let owner: pg.Client;
let a: Fixture;
let stayId: string;

/** Clears sessions and everything that references them, order-independently. */
async function clearSessions(): Promise<void> {
  await owner.query(`SET session_replication_role = replica`);
  try {
    for (const t of ['access_escalations', 'staff_vouches', 'verification_challenges',
                     'guest_sessions']) {
      await owner.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [TENANT_A]);
    }
  } finally {
    await owner.query(`SET session_replication_role = origin`);
  }
}

async function freshStay(): Promise<string> {
  // FK triggers suspended for the same reason as cleanup(): tracking the exact
  // children of guest_sessions by hand is how the last two failures happened.
  await clearSessions();
  await owner.query(`DELETE FROM stays WHERE tenant_id = $1`, [TENANT_A]);
  const r = await owner.query<{ id: string }>(`
    INSERT INTO stays (tenant_id, property_id, room_id, guest_id, status,
                       checked_in_at, scheduled_checkout_at)
    VALUES ($1,$2,$3,$4,'CHECKED_IN', now(), now() + interval '2 days') RETURNING id`,
    [TENANT_A, a.propertyId, a.roomId, a.guestId]);
  return r.rows[0]!.id;
}

beforeAll(async () => {
  owner = ownerClient();
  await owner.connect();
  await cleanup(owner);
  await owner.query(
    `INSERT INTO tenants (id,name,slug,status) VALUES ($1,'Tenant A','t-a','ACTIVE')
     ON CONFLICT (slug) DO NOTHING`, [TENANT_A]);
  a = await seedTenant(owner, TENANT_A, 'A');
  await owner.query(`UPDATE guests SET phone = '+919820011111' WHERE id = $1`, [a.guestId]);
  stayId = await freshStay();
}, 180_000);

afterAll(async () => {
  await cleanup(owner);
  await owner.query(`DELETE FROM tenants WHERE id = $1`, [TENANT_A]);
  await owner.end();
  await closePool();
});

describe('S7 · DONE CONDITION — a bare scan, nothing in the way', () => {
  it('issues a working session with isAnonymous:true and tier REQUEST', async () => {
    const scan = await scanQrCode(a.qrCode);
    expect(scan.session.isAnonymous).toBe(true);
    expect(scan.session.accessTier).toBe('REQUEST');
    expect(scan.session.roomNumber).toBe('214');
    expect(scan.property.name).toBe('Hotel A');

    // And the row agrees — this is the assertion S7 names.
    const row = await owner.query(
      `SELECT is_anonymous, access_tier FROM guest_sessions WHERE id = $1`, [scan.session.id]);
    expect(row.rows[0].is_anonymous).toBe(true);
    expect(row.rows[0].access_tier).toBe('REQUEST');
  });

  it('binds the session to the STAY, never the room (#10)', async () => {
    const scan = await scanQrCode(a.qrCode);
    const row = await owner.query(`SELECT stay_id FROM guest_sessions WHERE id = $1`, [scan.session.id]);
    expect(row.rows[0].stay_id).toBe(stayId);
  });

  it('stores the token as SHA-256 only (#10)', async () => {
    const scan = await scanQrCode(a.qrCode);
    const rawToken = scan.cookieValue.split('.').slice(1).join('.');
    const row = await owner.query(`SELECT token_hash FROM guest_sessions WHERE id = $1`, [scan.session.id]);
    expect(row.rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.rows[0].token_hash).not.toBe(rawToken);
  });

  it('resolves the cookie back to the same session', async () => {
    const scan = await scanQrCode(a.qrCode);
    const resolved = await resolveGuestSession(scan.cookieValue);
    expect(resolved?.id).toBe(scan.session.id);
    expect(resolved?.accessTier).toBe('REQUEST');
  });
});

describe('S7 · codes that must not resolve', () => {
  it('rejects an unknown code', async () => {
    await expect(scanQrCode('doesnotexist1')).rejects.toThrow(QrNotUsableError);
  });

  it('rejects a revoked code', async () => {
    await owner.query(`UPDATE room_qr_codes SET revoked_at = now() WHERE room_id = $1`, [a.roomId]);
    await expect(scanQrCode(a.qrCode)).rejects.toThrow(QrNotUsableError);
    await owner.query(`UPDATE room_qr_codes SET revoked_at = NULL WHERE room_id = $1`, [a.roomId]);
  });

  it('rejects a version mismatch — reprinting invalidates the old sticker', async () => {
    await expect(scanQrCode(a.qrCode, { version: 2 })).rejects.toThrow(QrNotUsableError);
    await expect(scanQrCode(a.qrCode, { version: 1 })).resolves.toBeTruthy();
  });

  it('rejects when nobody is checked in — and says no more than that', async () => {
    await owner.query(`UPDATE stays SET status='CHECKED_OUT' WHERE id=$1`, [stayId]);
    await expect(scanQrCode(a.qrCode)).rejects.toThrow(QrNotUsableError);
    await owner.query(`UPDATE stays SET status='CHECKED_IN' WHERE id=$1`, [stayId]);
  });

  it('ignores malformed codes without touching the database', async () => {
    for (const bad of ['', '../../etc/passwd', "'; DROP TABLE stays;--", 'x'.repeat(200)]) {
      await expect(scanQrCode(bad)).rejects.toThrow(QrNotUsableError);
    }
  });
});

describe('S7 · escalation is triggered by ACTION, not entry (D-012)', () => {
  it('lets a REQUEST session browse and raise free requests with no prompt', async () => {
    const scan = await scanQrCode(a.qrCode);
    for (const action of ['view_menu', 'view_pois', 'free_request', 'call_staff'] as const) {
      const check = await requireTier(scan.session, action);
      expect(check.required, action).toBe(false);
    }
  });

  it('escalates on the first attempt to charge — it does NOT 403', async () => {
    const scan = await scanQrCode(a.qrCode);
    const check = await requireTier(scan.session, 'place_order');
    expect(check.required).toBe(true);
    if (check.required) {
      expect(check.fromTier).toBe('REQUEST');
      expect(check.toTier).toBe('CHARGE');
      expect(check.methods).toContain('PHONE_LAST4');
    }
  });

  it('records exactly one escalation for one triggering action', async () => {
    await clearSessions();
    const scan = await scanQrCode(a.qrCode);
    await requireTier(scan.session, 'place_order');
    const rows = await owner.query(
      `SELECT triggered_by, outcome FROM access_escalations WHERE tenant_id=$1`, [TENANT_A]);
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].triggered_by).toBe('place_order');
    expect(rows.rows[0].outcome).toBe('STARTED');
  });

  /**
   * FULL, not CHARGE — D-031.
   *
   * D-012 calls this "the ONE verification prompt in the product". A guest who
   * answered it to send dinner up must not meet it again on the way to their own
   * bill, and the proof does not get stronger between the two: whoever can
   * answer this can already post to the room.
   *
   * It granted CHARGE until the folio screen existed, which left FULL — the rung
   * `view_folio` and `request_checkout` sit on — unreachable by any path in the
   * product.
   */
  it('raises the tier on the EXISTING session, not a new one', async () => {
    await clearSessions();
    const scan = await scanQrCode(a.qrCode);
    const challengeId = await startPhoneLast4Challenge(scan.session);
    const result = await answerChallenge(scan.session, challengeId, '1111');

    expect(result.ok).toBe(true);
    expect(result.newTier).toBe('FULL');

    const row = await owner.query(
      `SELECT access_tier, is_anonymous FROM guest_sessions WHERE id=$1`, [scan.session.id]);
    expect(row.rows[0].access_tier).toBe('FULL');
    expect(row.rows[0].is_anonymous).toBe(false);

    // The same cookie now carries the higher tier — nothing the guest was doing
    // was orphaned.
    const resolved = await resolveGuestSession(scan.cookieValue);
    expect(resolved?.accessTier).toBe('FULL');
  });

  it('asks once, for both the charge and the folio', async () => {
    await clearSessions();
    const scan = await scanQrCode(a.qrCode);

    // The prompt a guest meets on the cart.
    const check = await requireTier(scan.session, 'place_order');
    expect(check.required).toBe(true);

    const challengeId = await startPhoneLast4Challenge(scan.session);
    await answerChallenge(scan.session, challengeId, '1111');

    // And now the folio, on the same session, with nothing more asked.
    const verified = (await resolveGuestSession(scan.cookieValue))!;
    expect((await requireTier(verified, 'view_folio')).required).toBe(false);
    expect((await requireTier(verified, 'request_checkout')).required).toBe(false);
  });

  /**
   * The gap between CHARGE and FULL is about WHO vouched, not how much money is
   * at stake. The desk saying "yes, that is the guest in 214" lets a charge
   * through; it does not hand over the guest's bill.
   */
  it('a staff vouch stops short of the folio', async () => {
    await clearSessions();
    const scan = await scanQrCode(a.qrCode);
    const staff = await owner.query<{ id: string }>(
      `SELECT id FROM staff_users WHERE tenant_id=$1 LIMIT 1`, [TENANT_A]);

    await vouchForGuest({
      tenantId: TENANT_A, propertyId: a.propertyId, stayId,
      staffUserId: staff.rows[0]!.id, guestSessionId: scan.session.id,
    });

    const vouched = (await resolveGuestSession(scan.cookieValue))!;
    expect(vouched.accessTier).toBe('CHARGE');
    expect((await requireTier(vouched, 'place_order')).required).toBe(false);
    expect((await requireTier(vouched, 'view_folio')).required).toBe(true);
  });

  it('lets a desk that means to hand over the folio say so', async () => {
    await clearSessions();
    const scan = await scanQrCode(a.qrCode);
    const staff = await owner.query<{ id: string }>(
      `SELECT id FROM staff_users WHERE tenant_id=$1 LIMIT 1`, [TENANT_A]);

    await vouchForGuest({
      tenantId: TENANT_A, propertyId: a.propertyId, stayId,
      staffUserId: staff.rows[0]!.id, guestSessionId: scan.session.id,
      grantedTier: 'FULL',
    });

    expect((await resolveGuestSession(scan.cookieValue))?.accessTier).toBe('FULL');
  });

  it('never stores the last four digits in the clear', async () => {
    const rows = await owner.query(
      `SELECT phone_last4, challenge_hash FROM verification_challenges WHERE tenant_id=$1`, [TENANT_A]);
    for (const r of rows.rows) {
      expect(r.phone_last4).toBeNull();
      expect(r.challenge_hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('locks out after repeated wrong answers, counted per ROOM', async () => {
    await clearSessions();
    const scan = await scanQrCode(a.qrCode);

    let locked = false;
    // The default cap is 5 per room; 6 attempts is enough to cross it.
    for (let i = 0; i < 6 && !locked; i += 1) {
      try {
        const id = await startPhoneLast4Challenge(scan.session);
        await answerChallenge(scan.session, id, '0000');
      } catch (e) {
        if (e instanceof TooManyAttemptsError) locked = true; else throw e;
      }
    }
    // Without a per-room cap, last-4 is a five-attempt brute force
    // (DATA-MODEL §3) and starting a new challenge would reset the counter.
    expect(locked).toBe(true);
  });

  /**
   * The counter is for WRONG answers.
   *
   * It counted every attempt, successful ones included, which made the control
   * punish exactly the person it protects: a guest verifying on their phone,
   * then the tablet, then their partner's phone, then again after a session
   * lapsed, was locked out of their own room for thirty minutes having never
   * got it wrong once.
   */
  it('does not lock out a guest who keeps getting it right', async () => {
    await clearSessions();
    await owner.query(
      `DELETE FROM verification_challenges WHERE tenant_id = $1`, [TENANT_A]);

    // Six correct verifications on the same room, well past the cap of five.
    for (let i = 0; i < 6; i += 1) {
      const scan = await scanQrCode(a.qrCode);
      const challengeId = await startPhoneLast4Challenge(scan.session);
      const result = await answerChallenge(scan.session, challengeId, '1111');
      expect(result.ok, `attempt ${i + 1} should have succeeded`).toBe(true);
    }
  });

  it('still counts the wrong answers a successful challenge took', async () => {
    await clearSessions();
    await owner.query(
      `DELETE FROM verification_challenges WHERE tenant_id = $1`, [TENANT_A]);

    // Two challenges, each two wrong then right. The two successes are
    // forgiven; the four wrong answers are not.
    for (let round = 0; round < 2; round += 1) {
      const scan = await scanQrCode(a.qrCode);
      const challengeId = await startPhoneLast4Challenge(scan.session);
      await answerChallenge(scan.session, challengeId, '0000');
      await answerChallenge(scan.session, challengeId, '0000');
      await answerChallenge(scan.session, challengeId, '1111');
    }

    // Four wrong answers are on the room. The fifth locks it.
    const scan = await scanQrCode(a.qrCode);
    const challengeId = await startPhoneLast4Challenge(scan.session);
    await answerChallenge(scan.session, challengeId, '0000');
    await expect(startPhoneLast4Challenge(scan.session))
      .rejects.toBeInstanceOf(TooManyAttemptsError);
  });
});

describe('S7 · staff vouching — the guest sees no prompt at all', () => {
  it('raises every live session for the stay with zero guest interaction', async () => {
    await clearSessions();
    // Two devices — being vouched for on one is being vouched for.
    const phone = await scanQrCode(a.qrCode);
    const tablet = await scanQrCode(a.qrCode);
    expect(phone.session.accessTier).toBe('REQUEST');

    const staff = await owner.query<{ id: string }>(
      `SELECT id FROM staff_users WHERE tenant_id=$1 LIMIT 1`, [TENANT_A]);

    await vouchForGuest({
      tenantId: TENANT_A, propertyId: a.propertyId, stayId,
      staffUserId: staff.rows[0]!.id, guestSessionId: phone.session.id,
      reason: 'Confirmed passport at the desk',
    });

    for (const s of [phone, tablet]) {
      const resolved = await resolveGuestSession(s.cookieValue);
      expect(resolved?.accessTier).toBe('CHARGE');
      expect(resolved?.isAnonymous).toBe(false);
    }

    const vouch = await owner.query(
      `SELECT granted_tier, reason FROM staff_vouches WHERE tenant_id=$1`, [TENANT_A]);
    expect(vouch.rows[0].granted_tier).toBe('CHARGE');
  });

  it('refuses when the property has turned vouching off', async () => {
    await clearSessions();
    const scan = await scanQrCode(a.qrCode);
    const staff = await owner.query<{ id: string }>(
      `SELECT id FROM staff_users WHERE tenant_id=$1 LIMIT 1`, [TENANT_A]);

    // `allow_staff_vouch` exists so a group with a strict finance policy can
    // insist on the guest's own phone. It sat unread until a sweep found it,
    // which made the setting decorative.
    await owner.query(
      `UPDATE access_policies SET allow_staff_vouch = false WHERE property_id = $1`,
      [a.propertyId]);

    await expect(vouchForGuest({
      tenantId: TENANT_A, propertyId: a.propertyId, stayId,
      staffUserId: staff.rows[0]!.id, guestSessionId: scan.session.id,
    })).rejects.toBeInstanceOf(ForbiddenError);

    // And the session is untouched — a refused vouch must not half-apply.
    expect((await resolveGuestSession(scan.cookieValue))?.accessTier).toBe('REQUEST');
    const vouches = await owner.query(
      `SELECT id FROM staff_vouches WHERE tenant_id=$1 AND stay_id=$2`,
      [TENANT_A, stayId]);
    expect(vouches.rows).toHaveLength(0);

    await owner.query(
      `UPDATE access_policies SET allow_staff_vouch = true WHERE property_id = $1`,
      [a.propertyId]);
  });
});

describe('S7 · the access policy is read, not decorative', () => {
  it('takes the challenge attempt budget from the policy, not the column default', async () => {
    await clearSessions();
    // Both are 5 by default, which is exactly why nobody noticed the policy was
    // being ignored: a property that set 3 got 5.
    await owner.query(
      `UPDATE access_policies SET max_attempts_per_phone = 2 WHERE property_id = $1`,
      [a.propertyId]);

    const scan = await scanQrCode(a.qrCode);
    const challengeId = await startPhoneLast4Challenge(scan.session);

    const row = await owner.query(
      `SELECT max_attempts FROM verification_challenges WHERE id = $1`, [challengeId]);
    expect(row.rows[0].max_attempts).toBe(2);

    // And it is the budget the answer path actually spends: one wrong answer
    // leaves one, and the second crosses the policy's cap and locks the room.
    const first = await answerChallenge(scan.session, challengeId, '0000');
    expect(first.attemptsLeft).toBe(1);
    await expect(answerChallenge(scan.session, challengeId, '0000'))
      .rejects.toBeInstanceOf(TooManyAttemptsError);

    await owner.query(
      `UPDATE access_policies SET max_attempts_per_phone = 5 WHERE property_id = $1`,
      [a.propertyId]);
  });

  it('locks out for the policy\'s minutes, not a hardcoded thirty', async () => {
    await clearSessions();
    await owner.query(
      `UPDATE access_policies
         SET max_attempts_per_phone = 1, lockout_minutes = 7
       WHERE property_id = $1`, [a.propertyId]);

    const scan = await scanQrCode(a.qrCode);
    const challengeId = await startPhoneLast4Challenge(scan.session);

    await expect(answerChallenge(scan.session, challengeId, '0000'))
      .rejects.toBeInstanceOf(TooManyAttemptsError);

    const row = await owner.query<{ locked_until: Date }>(
      `SELECT locked_until FROM verification_challenges WHERE id = $1`, [challengeId]);
    const minutes = (row.rows[0]!.locked_until.getTime() - Date.now()) / 60_000;
    // Seven, give or take the round trip — and nowhere near thirty.
    expect(minutes).toBeGreaterThan(6);
    expect(minutes).toBeLessThan(8);

    await owner.query(
      `UPDATE access_policies
         SET max_attempts_per_phone = 5, lockout_minutes = 30
       WHERE property_id = $1`, [a.propertyId]);
  });
});

describe('S7 · checkout revokes every session (#10)', () => {
  it('a checked-out stay resolves to nothing', async () => {
    const scan = await scanQrCode(a.qrCode);
    expect(await resolveGuestSession(scan.cookieValue)).not.toBeNull();

    const revoked = await withTenant({ tenantId: TENANT_A }, (tx) =>
      revokeSessionsForStay(tx, stayId));
    expect(revoked).toBeGreaterThan(0);

    expect(await resolveGuestSession(scan.cookieValue)).toBeNull();
  });

  it('the next guest in the same room never sees the previous session', async () => {
    // D-007 + #10 together: the room is reused, the stay is not.
    const previous = await scanQrCode(a.qrCode);
    await owner.query(`UPDATE stays SET status='CHECKED_OUT' WHERE id=$1`, [stayId]);
    expect(await resolveGuestSession(previous.cookieValue)).toBeNull();

    stayId = await freshStay();
    const next = await scanQrCode(a.qrCode);
    expect(next.session.stayId).toBe(stayId);
    expect(next.session.id).not.toBe(previous.session.id);
    expect(next.session.accessTier).toBe('REQUEST');   // fresh, unverified
    expect(next.session.isAnonymous).toBe(true);
  });
});
