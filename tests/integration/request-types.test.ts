import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenant, readEventHistory } from '@/db';
import {
  getAdminRequestTypes, createRequestType, updateRequestType,
  setRequestTypeActive, archiveRequestType,
  getRequestCatalog, getRequestTypeByKey, raiseServiceRequest, advanceRequest,
} from '@/modules/requests';
import { listRolesAtProperty } from '@/modules/identity';
import {
  ownerClient, seedTenant, cleanup, checkInGuest, TENANT_A, TENANT_B, type Fixture,
} from './setup';

/**
 * `request_types`, editable — `/admin/requests`.
 *
 * The claims worth a real database: that an edit reaches the guest's own screen,
 * that the two derived columns cannot be made to disagree with the price, that a
 * routing role which does not exist is refused at the form rather than
 * discovered as requests nobody is ever assigned, and that #9 survives a
 * manager with a price field.
 */
describe('editing what guests can ask for', () => {
  let owner: pg.Client;
  let a: Fixture;
  let b: Fixture;
  let stayId: string;
  let gm = '';

  const scoped = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
    withTenant<T>({ tenantId: a.tenantId, propertyId: a.propertyId }, fn);

  const typeKeyed = async (key: string) =>
    (await scoped((tx) => getAdminRequestTypes(tx, { propertyId: a.propertyId })))
      .find((type) => type.key === key);

  /** The whole form, so a test only says what it is changing. */
  const edit = async (key: string, changes: Record<string, unknown> = {}) => {
    const before = (await typeKeyed(key))!;
    return scoped((tx) => updateRequestType(tx, {
      tenantId: a.tenantId,
      propertyId: a.propertyId,
      requestTypeId: before.id,
      name: before.name,
      description: before.description,
      category: before.category,
      priceMinor: before.priceMinor,
      slaMinutes: before.slaMinutes,
      routeToRoleKey: before.routeToRoleKey,
      allowsQuantity: before.allowsQuantity,
      maxQuantity: before.maxQuantity,
      allowsNote: before.allowsNote,
      allowsPhoto: before.allowsPhoto,
      actorStaffId: gm,
      ...changes,
    }));
  };

  const add = (changes: Record<string, unknown> = {}) =>
    scoped((tx) => createRequestType(tx, {
      tenantId: a.tenantId,
      propertyId: a.propertyId,
      name: 'Yoga mat',
      description: null,
      category: 'AMENITY',
      priceMinor: 0,
      slaMinutes: 20,
      routeToRoleKey: 'HOUSEKEEPING',
      allowsQuantity: false,
      maxQuantity: 1,
      allowsNote: true,
      allowsPhoto: false,
      actorStaffId: gm,
      ...changes,
    }));

  beforeAll(async () => {
    owner = ownerClient();
    await owner.connect();
    await cleanup(owner);
    a = await seedTenant(owner, TENANT_A, 'A');
    b = await seedTenant(owner, TENANT_B, 'B');
    stayId = await checkInGuest(a);

    const gmRow = await owner.query<{ id: string }>(
      `SELECT su.id FROM staff_users su
       JOIN staff_property_roles spr ON spr.staff_user_id = su.id
       JOIN roles r ON r.id = spr.role_id
       WHERE spr.property_id = $1 AND r.key = 'PROPERTY_ADMIN' LIMIT 1`, [a.propertyId]);
    gm = gmRow.rows[0]!.id;
  });

  /**
   * Restore the seeded catalog between tests. These edit a shared, provisioned
   * catalog rather than fixtures of their own — which is the point, since it is
   * the same 23 rows a real property starts with.
   */
  beforeEach(async () => {
    await owner.query(`SET session_replication_role = replica`);
    for (const t of ['service_request_items', 'service_requests', 'request_types',
                     'shift_zones', 'shifts', 'folio_lines', 'folios', 'idempotency_keys']) {
      await owner.query(`DELETE FROM ${t} WHERE tenant_id = ANY($1)`, [[TENANT_A, TENANT_B]]);
    }
    await owner.query(`DELETE FROM event_log WHERE tenant_id = ANY($1)`, [[TENANT_A, TENANT_B]]);
    await owner.query(`SET session_replication_role = origin`);

    const { seedDefaultRequestTypes } = await import('@/modules/requests');
    await scoped((tx) => seedDefaultRequestTypes(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId,
    }));
    await withTenant({ tenantId: b.tenantId, propertyId: b.propertyId }, (tx) =>
      seedDefaultRequestTypes(tx, { tenantId: b.tenantId, propertyId: b.propertyId }));
  });

  afterAll(async () => {
    await cleanup(owner);
    await owner.end();
  });

  /* ── Reading ─────────────────────────────────────────────────────────── */

  it('shows the seeded catalog, switched-off ones included', async () => {
    const towels = (await typeKeyed('EXTRA_TOWELS'))!;
    expect(towels.slaMinutes).toBe(12);
    expect(towels.routeToRoleKey).toBe('HOUSEKEEPING');
    expect(towels.isChargeable).toBe(false);

    await scoped((tx) => setRequestTypeActive(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId,
      requestTypeId: towels.id, isActive: false, actorStaffId: gm,
    }));

    // Still on the admin list — a property that cannot see the row cannot turn
    // it back on...
    expect((await typeKeyed('EXTRA_TOWELS'))!.isActive).toBe(false);
    // ...and gone from the guest's, which is the difference between the two.
    const guest = await scoped((tx) => getRequestCatalog(tx, { propertyId: a.propertyId }));
    expect(guest.find((card) => card.key === 'EXTRA_TOWELS')).toBeUndefined();
  });

  it('counts what is open against each type, for the archive button', async () => {
    const towels = (await typeKeyed('EXTRA_TOWELS'))!;
    expect(towels.liveCount).toBe(0);

    await scoped((tx) => raiseServiceRequest(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId, roomId: a.roomId,
      lines: [{ requestTypeId: towels.id, quantity: 1 }],
      idempotencyKey: `count-${Math.random()}`, accessTier: 'REQUEST',
    }));

    expect((await typeKeyed('EXTRA_TOWELS'))!.liveCount).toBe(1);
  });

  /* ── The edit reaching the guest ─────────────────────────────────────── */

  /**
   * The whole point of the screen. Before it, changing this number meant
   * editing `provision.ts` and re-running the seeder — which wipes the property.
   */
  it('a changed promise is what the guest is quoted, and what the sweep uses', async () => {
    await edit('EXTRA_TOWELS', { slaMinutes: 5 });

    const card = (await scoped((tx) =>
      getRequestCatalog(tx, { propertyId: a.propertyId })))
      .find((c) => c.key === 'EXTRA_TOWELS')!;
    expect(card.slaMinutes).toBe(5);

    // And the deadline moves with it: one number, not two.
    const raised = await scoped(async (tx) => {
      const type = await getRequestTypeByKey(tx, { propertyId: a.propertyId, key: 'EXTRA_TOWELS' });
      return raiseServiceRequest(tx, {
        tenantId: a.tenantId, propertyId: a.propertyId, stayId, roomId: a.roomId,
        lines: [{ requestTypeId: type!.id, quantity: 1 }],
        idempotencyKey: `sla-${Math.random()}`, accessTier: 'REQUEST',
      });
    });
    const minutes = (raised.slaTargetAt.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(4);
    expect(minutes).toBeLessThan(6);
  });

  it('a rename does not move the key the one-tap screen looks up', async () => {
    await edit('CALL_SERVICE', { name: 'Ring for the butler' });

    const found = await scoped((tx) =>
      getRequestTypeByKey(tx, { propertyId: a.propertyId, key: 'CALL_SERVICE' }));
    expect(found?.name).toBe('Ring for the butler');
  });

  /* ── #9 ──────────────────────────────────────────────────────────────── */

  /**
   * `raiseServiceRequest()` demands the CHARGE tier as soon as a request totals
   * more than zero, so a price here is a verification prompt in front of the one
   * tap — the exact screen #9 keeps out of the way.
   */
  it('refuses to put a price on the one tap', async () => {
    await expect(edit('CALL_SERVICE', { priceMinor: 100 }))
      .rejects.toThrow(/stay free/i);

    // Unchanged, and still raisable at the bare REQUEST tier with no prompt.
    const call = (await typeKeyed('CALL_SERVICE'))!;
    expect(call.priceMinor).toBe(0);
    await expect(scoped((tx) => raiseServiceRequest(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId, roomId: a.roomId,
      lines: [{ requestTypeId: call.id, quantity: 1 }],
      idempotencyKey: `free-${Math.random()}`, accessTier: 'REQUEST',
    }))).resolves.toBeTruthy();
  });

  it('lets everything else be priced, and then asks the guest to verify', async () => {
    await edit('EXTRA_TOWELS', { priceMinor: 20_000 });

    const towels = (await typeKeyed('EXTRA_TOWELS'))!;
    expect(towels.priceMinor).toBe(20_000);
    // Derived, never set: the guest screen prints Free or the amount from this.
    expect(towels.isChargeable).toBe(true);

    await expect(scoped((tx) => raiseServiceRequest(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId, roomId: a.roomId,
      lines: [{ requestTypeId: towels.id, quantity: 1 }],
      idempotencyKey: `paid-${Math.random()}`, accessTier: 'REQUEST',
    }))).rejects.toThrow(/who you are/i);
  });

  it('takes the price back off and the flag follows it down', async () => {
    await edit('EXTRA_TOWELS', { priceMinor: 20_000 });
    await edit('EXTRA_TOWELS', { priceMinor: 0 });
    expect((await typeKeyed('EXTRA_TOWELS'))!.isChargeable).toBe(false);
  });

  /* ── Routing ─────────────────────────────────────────────────────────── */

  it('refuses a role that does not exist here', async () => {
    await expect(edit('EXTRA_TOWELS', { routeToRoleKey: 'BUTLER' }))
      .rejects.toThrow(/No role called "BUTLER"/);
    await expect(add({ routeToRoleKey: 'CONCEIRGE' }))
      .rejects.toThrow(/never assigned/);
  });

  it('allows a real role that nobody holds yet — a rota is built before it is staffed',
    async () => {
      const roles = await scoped((tx) => listRolesAtProperty(tx, { propertyId: a.propertyId }));
      const empty = roles.find((role) => role.staffCount === 0);
      expect(empty, 'the seeded property should have at least one unstaffed role').toBeTruthy();

      await edit('EXTRA_TOWELS', { routeToRoleKey: empty!.key });
      expect((await typeKeyed('EXTRA_TOWELS'))!.routeToRoleKey).toBe(empty!.key);
    });

  it('counts who holds each role, so an empty one is visible on the form', async () => {
    const roles = await scoped((tx) => listRolesAtProperty(tx, { propertyId: a.propertyId }));
    const housekeeping = roles.find((role) => role.key === 'HOUSEKEEPING');
    expect(housekeeping).toBeTruthy();
    expect(roles.find((role) => role.key === 'PROPERTY_ADMIN')!.staffCount).toBeGreaterThan(0);
  });

  /* ── Creating ────────────────────────────────────────────────────────── */

  it('mints a key from the name, and a guest can ask for it immediately', async () => {
    const created = await add({ name: 'Yoga mat' });
    expect(created.key).toBe('YOGA_MAT');

    const card = (await scoped((tx) => getRequestCatalog(tx, { propertyId: a.propertyId })))
      .find((c) => c.key === 'YOGA_MAT');
    expect(card?.name).toBe('Yoga mat');
    expect(card?.slaMinutes).toBe(20);
  });

  it('numbers a second one of the same name rather than failing on the index', async () => {
    await add({ name: 'Yoga mat' });
    const second = await add({ name: 'Yoga mat' });
    expect(second.key).toBe('YOGA_MAT_2');
  });

  it('will not reuse the key of something archived', async () => {
    const first = await add({ name: 'Yoga mat' });
    await scoped((tx) => archiveRequestType(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId,
      requestTypeId: first.id, actorStaffId: gm,
    }));

    // The unique index does not know about `archived_at`; reusing the key would
    // be a 23505 rather than a message.
    const second = await add({ name: 'Yoga mat' });
    expect(second.key).toBe('YOGA_MAT_2');
  });

  it('refuses a name with nothing to make a key out of', async () => {
    await expect(add({ name: '!!!' })).rejects.toThrow(/letters or numbers/i);
  });

  /* ── Archiving ───────────────────────────────────────────────────────── */

  it('refuses to archive something still being worked, and says how many', async () => {
    const towels = (await typeKeyed('EXTRA_TOWELS'))!;
    await scoped((tx) => raiseServiceRequest(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId, roomId: a.roomId,
      lines: [{ requestTypeId: towels.id, quantity: 1 }],
      idempotencyKey: `busy-${Math.random()}`, accessTier: 'REQUEST',
    }));

    await expect(scoped((tx) => archiveRequestType(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId,
      requestTypeId: towels.id, actorStaffId: gm,
    }))).rejects.toThrow(/One request of this kind is still open/);
  });

  it('archives once the work is finished, and old requests still read correctly',
    async () => {
      const towels = (await typeKeyed('EXTRA_TOWELS'))!;
      const raised = await scoped((tx) => raiseServiceRequest(tx, {
        tenantId: a.tenantId, propertyId: a.propertyId, stayId, roomId: a.roomId,
        lines: [{ requestTypeId: towels.id, quantity: 2 }],
        idempotencyKey: `drain-${Math.random()}`, accessTier: 'REQUEST',
      }));
      for (const to of ['IN_PROGRESS', 'COMPLETED', 'VERIFIED'] as const) {
        await scoped((tx) => advanceRequest(tx, {
          tenantId: a.tenantId, propertyId: a.propertyId,
          requestId: raised.requestId, to, actor: { kind: 'SYSTEM' },
        }));
      }

      await scoped((tx) => archiveRequestType(tx, {
        tenantId: a.tenantId, propertyId: a.propertyId,
        requestTypeId: towels.id, actorStaffId: gm,
      }));

      expect(await typeKeyed('EXTRA_TOWELS')).toBeUndefined();
      expect(await scoped((tx) =>
        getRequestTypeByKey(tx, { propertyId: a.propertyId, key: 'EXTRA_TOWELS' }))).toBeNull();

      // #6 — the line snapshotted its label, so the finished request still says
      // what it was for after the type is gone.
      const lines = await owner.query<{ label_snapshot: string }>(
        `SELECT label_snapshot FROM service_request_items WHERE service_request_id = $1`,
        [raised.requestId]);
      expect(lines.rows[0]!.label_snapshot).toBe('Extra towels');
    });

  /* ── The audit trail ─────────────────────────────────────────────────── */

  it('logs who changed what, as a diff rather than a snapshot', async () => {
    const towels = (await typeKeyed('EXTRA_TOWELS'))!;
    await edit('EXTRA_TOWELS', { slaMinutes: 5, name: 'Towels' });

    const history = await scoped((tx) => readEventHistory(tx, 'request_type', towels.id));
    const updated = history.find((event) => event.event_type === 'request_type.updated');
    expect(updated).toBeTruthy();

    const changed = (updated!.payload as { changed: Record<string, { from: unknown; to: unknown }> })
      .changed;
    expect(changed.slaMinutes).toEqual({ from: 12, to: 5 });
    expect(changed.name).toEqual({ from: 'Extra towels', to: 'Towels' });
    // Only what moved — "who took towels from twelve minutes to five" should not
    // be a spot-the-difference puzzle.
    expect(Object.keys(changed).sort()).toEqual(['name', 'slaMinutes']);
  });

  it('logs the switch and the archive too', async () => {
    const type = await add({ name: 'Yoga mat' });
    await scoped((tx) => setRequestTypeActive(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId,
      requestTypeId: type.id, isActive: false, actorStaffId: gm,
    }));
    await scoped((tx) => archiveRequestType(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId,
      requestTypeId: type.id, actorStaffId: gm,
    }));

    const history = await scoped((tx) => readEventHistory(tx, 'request_type', type.id));
    expect(history.map((event) => event.event_type).sort()).toEqual([
      'request_type.archived', 'request_type.created', 'request_type.deactivated',
    ]);
  });

  /* ── Isolation ───────────────────────────────────────────────────────── */

  it('another hotel cannot read or edit this hotel\'s catalog', async () => {
    const towels = (await typeKeyed('EXTRA_TOWELS'))!;

    const leaked = await withTenant(
      { tenantId: b.tenantId, propertyId: b.propertyId },
      (tx) => getAdminRequestTypes(tx, { propertyId: a.propertyId }),
    );
    expect(leaked).toEqual([]);

    await expect(withTenant(
      { tenantId: b.tenantId, propertyId: b.propertyId },
      (tx) => setRequestTypeActive(tx, {
        tenantId: b.tenantId, propertyId: a.propertyId,
        requestTypeId: towels.id, isActive: false, actorStaffId: gm,
      }),
    )).rejects.toThrow();

    expect((await typeKeyed('EXTRA_TOWELS'))!.isActive).toBe(true);
  });

  it('edits one hotel and leaves the other alone', async () => {
    await edit('EXTRA_TOWELS', { slaMinutes: 5 });

    const theirs = await withTenant(
      { tenantId: b.tenantId, propertyId: b.propertyId },
      (tx) => getAdminRequestTypes(tx, { propertyId: b.propertyId }),
    );
    expect(theirs.find((type) => type.key === 'EXTRA_TOWELS')!.slaMinutes).toBe(12);
  });
});
