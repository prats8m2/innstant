import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenant, readEventHistory } from '@/db';
import {
  listStaffAtProperty, inviteStaff, reissueInvite, describeInvite, acceptInvite,
  updateStaff, deactivateStaff, reactivateStaff, assignRole, revokeRole,
  login, resolveStaffSession, createStaffSession,
} from '@/modules/identity';
import {
  ownerClient, seedTenant, cleanup, TENANT_A, TENANT_B, type Fixture,
} from './setup';

/**
 * P3.5 — a hotel adding its second staff member.
 *
 * `provisionProperty()` has created exactly one PROPERTY_ADMIN as INVITED with
 * `password_hash` NULL since P0, and S5 never built the flow that fills it in.
 * The claims worth a real database are the ones that span tables: that accepting
 * a link sets a password AND burns the token in one transaction, that switching
 * somebody off kills the sessions they are holding, and that a property can
 * never be left without an admin.
 */
describe('staff and roles', () => {
  let owner: pg.Client;
  let a: Fixture;
  let b: Fixture;
  let gm = '';

  const scoped = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
    withTenant<T>({ tenantId: a.tenantId, propertyId: a.propertyId }, fn);

  const staffNow = () => scoped((tx) => listStaffAtProperty(tx, { propertyId: a.propertyId }));

  const invite = (over: Record<string, unknown> = {}) => scoped((tx) => inviteStaff(tx, {
    tenantId: a.tenantId, propertyId: a.propertyId,
    email: 'anita@hotel-a.example', fullName: 'Anita Rao',
    roleKey: 'FRONT_DESK', staffUserId: gm, ...over,
  }));

  beforeAll(async () => {
    owner = ownerClient();
    await owner.connect();
    await cleanup(owner);
    a = await seedTenant(owner, TENANT_A, 'A');
    b = await seedTenant(owner, TENANT_B, 'B');

    const gmRow = await owner.query<{ id: string }>(
      `SELECT su.id FROM staff_users su
       JOIN staff_property_roles spr ON spr.staff_user_id = su.id
       JOIN roles r ON r.id = spr.role_id
       WHERE spr.property_id = $1 AND r.key = 'PROPERTY_ADMIN' LIMIT 1`, [a.propertyId]);
    gm = gmRow.rows[0]!.id;
  });

  beforeEach(async () => {
    await owner.query(`SET session_replication_role = replica`);
    await owner.query(`DELETE FROM staff_invites WHERE tenant_id = ANY($1)`, [[TENANT_A, TENANT_B]]);
    // Everybody these tests invited, but never the fixture's own admin.
    await owner.query(
      `DELETE FROM staff_sessions WHERE staff_user_id <> $1 AND tenant_id = ANY($2)`,
      [gm, [TENANT_A, TENANT_B]]);
    await owner.query(
      `DELETE FROM staff_property_roles WHERE staff_user_id <> $1 AND tenant_id = ANY($2)`,
      [gm, [TENANT_A, TENANT_B]]);
    await owner.query(
      `DELETE FROM staff_users WHERE id <> $1 AND tenant_id = ANY($2)`,
      [gm, [TENANT_A, TENANT_B]]);
    await owner.query(
      `UPDATE staff_users SET status = 'ACTIVE' WHERE id = $1`, [gm]);
    await owner.query(`DELETE FROM event_log WHERE tenant_id = ANY($1)`, [[TENANT_A, TENANT_B]]);
    await owner.query(`SET session_replication_role = origin`);
  });

  afterAll(async () => {
    await cleanup(owner);
    await owner.end();
  });

  /* ── Inviting ────────────────────────────────────────────────────────── */

  it('invites somebody, who appears before they have signed in', async () => {
    const issued = await invite();

    expect(issued.token).toBeTruthy();
    expect(issued.rejoined).toBe(false);

    const listed = (await staffNow()).find((m) => m.email === 'anita@hotel-a.example');
    expect(listed?.status).toBe('INVITED');
    expect(listed?.roleKeys).toEqual(['FRONT_DESK']);
    expect(listed?.inviteLive).toBe(true);
    expect(listed?.lastLoginAt).toBeNull();

    const history = await scoped((tx) => readEventHistory(tx, 'staff_user', issued.staffUserId));
    expect(history[0]!.event_type).toBe('staff.invited');
  });

  /** #10 — the token is stored as SHA-256 only, exactly like a session token. */
  it('never stores the token in the clear', async () => {
    const issued = await invite();
    const rows = await owner.query<{ token_hash: string }>(
      `SELECT token_hash FROM staff_invites WHERE staff_user_id = $1`, [issued.staffUserId]);

    expect(rows.rows[0]!.token_hash).not.toBe(issued.token);
    expect(rows.rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);

    const history = await scoped((tx) => readEventHistory(tx, 'staff_user', issued.staffUserId));
    expect(JSON.stringify(history)).not.toContain(issued.token);
  });

  it('reads the link back without accepting it', async () => {
    const issued = await invite();
    const described = await scoped((tx) => describeInvite(tx, issued.token));

    expect(described?.fullName).toBe('Anita Rao');
    expect(described?.propertyId).toBe(a.propertyId);
    // Still live — describing is not accepting.
    expect((await staffNow()).find((m) => m.email === 'anita@hotel-a.example')?.inviteLive)
      .toBe(true);
  });

  /**
   * The whole point: an INVITED row with no password becomes somebody who can
   * sign in. `login()` refuses anything that is not ACTIVE, so this is the only
   * door.
   */
  it('accepting sets a password, activates the account and burns the link', async () => {
    const issued = await invite();

    await scoped((tx) => acceptInvite(tx, {
      tenantId: a.tenantId, token: issued.token, password: 'a-long-enough-one',
    }));

    const listed = (await staffNow()).find((m) => m.email === 'anita@hotel-a.example');
    expect(listed?.status).toBe('ACTIVE');
    expect(listed?.inviteLive).toBe(false);

    // And they can actually sign in.
    const session = await login(
      { tenantSlug: 'a', email: 'anita@hotel-a.example', password: 'a-long-enough-one' },
      { tenantId: a.tenantId },
    );
    expect(session.cookieValue).toBeTruthy();

    // The link is spent. A second use would be a credential reset anybody
    // holding the old chat message could perform.
    await expect(scoped((tx) => acceptInvite(tx, {
      tenantId: a.tenantId, token: issued.token, password: 'another-long-one',
    }))).rejects.toThrow(/expired or has already been used/);
  });

  /**
   * A raw `execute` hands timestamps back unparsed, and the screen renders this
   * one through `Intl` — which throws RangeError on anything that is not a real
   * Date, three layers away from the query that produced it. It did.
   */
  it('hands back a real Date for the last sign-in', async () => {
    const issued = await invite();
    await scoped((tx) => acceptInvite(tx, {
      tenantId: a.tenantId, token: issued.token, password: 'a-long-enough-one',
    }));
    await login(
      { tenantSlug: 'a', email: 'anita@hotel-a.example', password: 'a-long-enough-one' },
      { tenantId: a.tenantId },
    );

    const listed = (await staffNow()).find((m) => m.id === issued.staffUserId);
    expect(listed?.lastLoginAt).toBeInstanceOf(Date);
    expect(Number.isNaN(listed!.lastLoginAt!.getTime())).toBe(false);
  });

  it('refuses a password nobody could defend', async () => {
    const issued = await invite();
    await expect(scoped((tx) => acceptInvite(tx, {
      tenantId: a.tenantId, token: issued.token, password: 'short',
    }))).rejects.toThrow(/at least 12/);

    // And the link survives a rejected attempt — otherwise a typo would cost
    // somebody their invite.
    expect(await scoped((tx) => describeInvite(tx, issued.token))).toBeTruthy();
  });

  /**
   * `staff_invites_one_live_per_staff` allows exactly one. Re-inviting has to
   * mean the newest link is the only one that works, or revoking the link a
   * manager can see leaves an older one alive.
   */
  it('a new link kills the old one', async () => {
    const first = await invite();
    const second = await scoped((tx) => reissueInvite(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId,
      targetStaffId: first.staffUserId, staffUserId: gm,
    }));

    expect(second.token).not.toBe(first.token);
    expect(await scoped((tx) => describeInvite(tx, first.token))).toBeNull();
    expect(await scoped((tx) => describeInvite(tx, second.token))).toBeTruthy();
  });

  it('will not send a link to somebody who already has a password', async () => {
    const issued = await invite();
    await scoped((tx) => acceptInvite(tx, {
      tenantId: a.tenantId, token: issued.token, password: 'a-long-enough-one',
    }));

    await expect(scoped((tx) => reissueInvite(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId,
      targetStaffId: issued.staffUserId, staffUserId: gm,
    }))).rejects.toThrow(/already has a password/);
  });

  /**
   * D-006 — a group with six hotels is ONE tenant and six properties, so its F&B
   * manager is one account with three grants rather than three logins.
   * `staff_users_tenant_email_uq` is what makes that true.
   */
  it('adds an existing colleague to this property without a second account', async () => {
    const first = await invite({ roleKey: 'FRONT_DESK' });
    await scoped((tx) => acceptInvite(tx, {
      tenantId: a.tenantId, token: first.token, password: 'a-long-enough-one',
    }));

    const again = await invite({ roleKey: 'CONCIERGE' });

    expect(again.staffUserId).toBe(first.staffUserId);
    expect(again.rejoined).toBe(true);
    // No link: they already have a password, and minting one would put a live
    // credential-setting URL in a chat window for nothing.
    expect(again.token).toBe('');

    const listed = (await staffNow()).find((m) => m.email === 'anita@hotel-a.example');
    expect([...listed!.roleKeys].sort()).toEqual(['CONCIERGE', 'FRONT_DESK']);
  });

  /* ── Switching somebody off ──────────────────────────────────────────── */

  /**
   * Not optional, and the reason deactivation is a transaction rather than a
   * status flip: a staff session lives for its TTL, so flipping the status alone
   * leaves the kitchen screen they are logged into working until the cookie ages
   * out.
   */
  it('switching somebody off stops every device they are signed in on', async () => {
    const issued = await invite();
    await scoped((tx) => acceptInvite(tx, {
      tenantId: a.tenantId, token: issued.token, password: 'a-long-enough-one',
    }));

    const session = await scoped((tx) => createStaffSession(tx, {
      tenantId: a.tenantId, staffUserId: issued.staffUserId,
    }));
    expect(await resolveStaffSession(session.cookieValue)).toBeTruthy();

    await scoped((tx) => deactivateStaff(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId,
      targetStaffId: issued.staffUserId, staffUserId: gm,
    }));

    expect(await resolveStaffSession(session.cookieValue)).toBeNull();
    await expect(login(
      { tenantSlug: 'a', email: 'anita@hotel-a.example', password: 'a-long-enough-one' },
      { tenantId: a.tenantId },
    )).rejects.toThrow();
  });

  it('keeps their roles and their history', async () => {
    const issued = await invite();
    await scoped((tx) => deactivateStaff(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId,
      targetStaffId: issued.staffUserId, staffUserId: gm,
    }));

    const listed = (await staffNow()).find((m) => m.email === 'anita@hotel-a.example');
    expect(listed?.status).toBe('DISABLED');
    expect(listed?.roleKeys).toEqual(['FRONT_DESK']);
    // Their live link died with them.
    expect(listed?.inviteLive).toBe(false);
  });

  /** Their old password went with them. Reactivating is not handing it back. */
  it('reactivating needs a new link, not the old password', async () => {
    const issued = await invite();
    await scoped((tx) => acceptInvite(tx, {
      tenantId: a.tenantId, token: issued.token, password: 'a-long-enough-one',
    }));
    await scoped((tx) => deactivateStaff(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId,
      targetStaffId: issued.staffUserId, staffUserId: gm,
    }));

    const back = await scoped((tx) => reactivateStaff(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId,
      targetStaffId: issued.staffUserId, staffUserId: gm,
    }));
    expect(back.needsInvite).toBe(true);

    await expect(login(
      { tenantSlug: 'a', email: 'anita@hotel-a.example', password: 'a-long-enough-one' },
      { tenantId: a.tenantId },
    )).rejects.toThrow();

    const fresh = await scoped((tx) => reissueInvite(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId,
      targetStaffId: issued.staffUserId, staffUserId: gm,
    }));
    await scoped((tx) => acceptInvite(tx, {
      tenantId: a.tenantId, token: fresh.token, password: 'a-different-long-one',
    }));

    const session = await login(
      { tenantSlug: 'a', email: 'anita@hotel-a.example', password: 'a-different-long-one' },
      { tenantId: a.tenantId },
    );
    expect(session.cookieValue).toBeTruthy();
  });

  it('will not let somebody switch themselves off', async () => {
    await expect(scoped((tx) => deactivateStaff(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId,
      targetStaffId: gm, staffUserId: gm,
    }))).rejects.toThrow(/your own account/);
  });

  /* ── The invariant ───────────────────────────────────────────────────── */

  /**
   * A hotel that locks itself out of its own console on a Tuesday afternoon has
   * no route back that does not involve us and a database prompt. This is the
   * guard that stops it, and it is why every path through this module counts
   * admins before it writes.
   */
  it('refuses to leave the property without an admin', async () => {
    const other = await invite({ roleKey: 'PROPERTY_ADMIN' });

    // With two, either can go.
    await scoped((tx) => deactivateStaff(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId,
      targetStaffId: other.staffUserId, staffUserId: gm,
    }));

    // With one left, the role cannot be taken away either.
    await expect(scoped((tx) => revokeRole(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId,
      targetStaffId: gm, roleKey: 'PROPERTY_ADMIN', staffUserId: gm,
    }))).rejects.toThrow();
  });

  it('counts an invited admin who has not signed in yet', async () => {
    // They hold the role and a link that makes them able to use it — the same
    // reasoning listRolesAtProperty() gives for counting them in the rota.
    const invited = await invite({ roleKey: 'PROPERTY_ADMIN' });
    expect(invited.token).toBeTruthy();

    await scoped((tx) => assignRole(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId,
      targetStaffId: gm, roleKey: 'FRONT_DESK', staffUserId: gm,
    }));

    await expect(scoped((tx) => revokeRole(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId,
      targetStaffId: gm, roleKey: 'PROPERTY_ADMIN', staffUserId: gm,
    }))).resolves.toBeUndefined();
  });

  /* ── Roles ───────────────────────────────────────────────────────────── */

  it('adds and removes a role', async () => {
    const issued = await invite();

    await scoped((tx) => assignRole(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId,
      targetStaffId: issued.staffUserId, roleKey: 'CONCIERGE', staffUserId: gm,
    }));

    let listed = (await staffNow()).find((m) => m.id === issued.staffUserId);
    expect([...listed!.roleKeys].sort()).toEqual(['CONCIERGE', 'FRONT_DESK']);

    await scoped((tx) => revokeRole(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId,
      targetStaffId: issued.staffUserId, roleKey: 'CONCIERGE', staffUserId: gm,
    }));

    listed = (await staffNow()).find((m) => m.id === issued.staffUserId);
    expect(listed!.roleKeys).toEqual(['FRONT_DESK']);
  });

  it('refuses the same role twice', async () => {
    const issued = await invite();
    await expect(scoped((tx) => assignRole(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId,
      targetStaffId: issued.staffUserId, roleKey: 'FRONT_DESK', staffUserId: gm,
    }))).rejects.toThrow(/already has that role/);
  });

  /**
   * An account with no role at a property can sign in, sees a console with
   * nothing in it, and gives nobody any clue why. Switching them off is the
   * honest way to stop somebody working here.
   */
  it('refuses to take away somebody\'s only role', async () => {
    const issued = await invite();
    await expect(scoped((tx) => revokeRole(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId,
      targetStaffId: issued.staffUserId, roleKey: 'FRONT_DESK', staffUserId: gm,
    }))).rejects.toThrow(/only role here/);
  });

  it('refuses a role that does not exist', async () => {
    const issued = await invite();
    await expect(scoped((tx) => assignRole(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId,
      targetStaffId: issued.staffUserId, roleKey: 'REGIONAL_OVERLORD', staffUserId: gm,
    }))).rejects.toThrow(/role that exists here/);
  });

  it('edits a name and a phone number', async () => {
    const issued = await invite();
    await scoped((tx) => updateStaff(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId,
      targetStaffId: issued.staffUserId,
      fullName: 'Anita Rao-Mehta', phone: '+919820011111', staffUserId: gm,
    }));

    const listed = (await staffNow()).find((m) => m.id === issued.staffUserId);
    expect(listed?.fullName).toBe('Anita Rao-Mehta');
    expect(listed?.phone).toBe('+919820011111');
  });

  /* ── Isolation ───────────────────────────────────────────────────────── */

  it('another hotel cannot touch this one\'s staff', async () => {
    const issued = await invite();

    await expect(withTenant(
      { tenantId: b.tenantId, propertyId: b.propertyId },
      (tx) => deactivateStaff(tx, {
        tenantId: b.tenantId, propertyId: a.propertyId,
        targetStaffId: issued.staffUserId, staffUserId: gm,
      }),
    )).rejects.toThrow();

    await expect(withTenant(
      { tenantId: b.tenantId, propertyId: b.propertyId },
      (tx) => describeInvite(tx, issued.token),
    )).resolves.toBeNull();

    expect((await staffNow()).find((m) => m.id === issued.staffUserId)?.status).toBe('INVITED');
  });
});
