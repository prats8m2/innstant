import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenant, closePool } from '@/db';
import {
  scanQrCode, resolveGuestSession, revokeSessionsForStay, requireTier,
  startPhoneLast4Challenge, answerChallenge, vouchForGuest, QrNotUsableError,
} from '@/modules/access';
import { TooManyAttemptsError } from '@/lib/errors';
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

  it('raises the tier on the EXISTING session, not a new one', async () => {
    await clearSessions();
    const scan = await scanQrCode(a.qrCode);
    const challengeId = await startPhoneLast4Challenge(scan.session);
    const result = await answerChallenge(scan.session, challengeId, '1111');

    expect(result.ok).toBe(true);
    expect(result.newTier).toBe('CHARGE');

    const row = await owner.query(
      `SELECT access_tier, is_anonymous FROM guest_sessions WHERE id=$1`, [scan.session.id]);
    expect(row.rows[0].access_tier).toBe('CHARGE');
    expect(row.rows[0].is_anonymous).toBe(false);

    // The same cookie now carries the higher tier — nothing the guest was doing
    // was orphaned.
    const resolved = await resolveGuestSession(scan.cookieValue);
    expect(resolved?.accessTier).toBe('CHARGE');
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
