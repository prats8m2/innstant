import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenant, subscribeToChannel, closeNotifyConnection } from '@/db';
import {
  queueNotifications, notificationsFor, unacknowledgedCount, acknowledgeAll,
  deliverInApp, NOTIFICATION_CHANNEL, renderNotification,
  type StaffNotifiedPayload,
} from '@/modules/notifications';
import {
  getRequestTypeByKey, raiseServiceRequest, escalateBreachesFor,
} from '@/modules/requests';
import {
  ownerClient, seedTenant, cleanup, checkInGuest, TENANT_A, TENANT_B, type Fixture,
} from './setup';

/**
 * Delivering the notification rows — the asterisk on P2's exit criterion.
 *
 * The sweep has always WRITTEN a row before anything was sent (DATA-MODEL §8),
 * which is the half that makes a missed alert diagnosable. This suite is about
 * the other half: that a row reaches the person it names, that the status says
 * honestly whether a screen has had it, and that it reaches nobody else.
 */
describe('delivering notifications', () => {
  let owner: pg.Client;
  let a: Fixture;
  let b: Fixture;
  let stayId: string;
  let gm = '';
  let sunita = '';
  let ravi = '';

  const scoped = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
    withTenant<T>({ tenantId: a.tenantId, propertyId: a.propertyId }, fn);

  const statusOf = async (id: string) => {
    const rows = await owner.query<{ status: string; sent_at: Date | null; attempts: number }>(
      `SELECT status, sent_at, attempts FROM notifications WHERE id = $1`, [id]);
    return rows.rows[0]!;
  };

  const queueFor = (staffUserId: string, template = 'service_request.escalated') =>
    scoped((tx) => queueNotifications(tx, [{
      tenantId: a.tenantId,
      propertyId: a.propertyId,
      channel: 'IN_APP',
      recipientStaffId: staffUserId,
      entityType: 'service_request',
      entityId: null,
      template,
      payload: { requestNumber: 'SR-0001', level: 2, minutesLate: 14 },
    }]));

  const addStaff = async (email: string, name: string, roleKey: string) => {
    const staff = await owner.query<{ id: string }>(
      `INSERT INTO staff_users (tenant_id, email, full_name, status)
       VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`, [TENANT_A, email, name]);
    const role = await owner.query<{ id: string }>(
      `SELECT id FROM roles WHERE tenant_id = $1 AND key = $2`, [TENANT_A, roleKey]);
    await owner.query(
      `INSERT INTO staff_property_roles (tenant_id, staff_user_id, property_id, role_id)
       VALUES ($1, $2, $3, $4)`, [TENANT_A, staff.rows[0]!.id, a.propertyId, role.rows[0]!.id]);
    return staff.rows[0]!.id;
  };

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

    sunita = await addStaff('bell-sunita@test.example', 'Sunita Devi', 'HOUSEKEEPING');
    ravi = await addStaff('bell-ravi@test.example', 'Ravi Kumar', 'HOUSEKEEPING');
  });

  beforeEach(async () => {
    await owner.query(`SET session_replication_role = replica`);
    for (const t of ['service_request_items', 'service_requests', 'notifications',
                     'shift_zones', 'shifts', 'idempotency_keys']) {
      await owner.query(`DELETE FROM ${t} WHERE tenant_id = ANY($1)`, [[TENANT_A, TENANT_B]]);
    }
    await owner.query(`DELETE FROM event_log WHERE tenant_id = ANY($1)`, [[TENANT_A, TENANT_B]]);
    await owner.query(`SET session_replication_role = origin`);
  });

  afterAll(async () => {
    await closeNotifyConnection();
    await cleanup(owner);
    await owner.end();
  });

  /* ── The drainer ─────────────────────────────────────────────────────── */

  it('writes the row PENDING — nothing has been on a screen yet', async () => {
    await queueFor(gm);
    const [row] = await scoped((tx) =>
      notificationsFor(tx, { propertyId: a.propertyId, staffUserId: gm }));

    const state = await statusOf(row!.id);
    expect(state.status).toBe('PENDING');
    expect(state.sent_at).toBeNull();
    expect(state.attempts).toBe(0);
  });

  it('marks it SENT the moment a screen belonging to the recipient asks', async () => {
    await queueFor(gm);
    const delivered = await scoped((tx) =>
      deliverInApp(tx, { propertyId: a.propertyId, staffUserId: gm }));
    expect(delivered).toBe(1);

    const [row] = await scoped((tx) =>
      notificationsFor(tx, { propertyId: a.propertyId, staffUserId: gm }));
    const state = await statusOf(row!.id);
    expect(state.status).toBe('SENT');
    expect(state.sent_at).not.toBeNull();
    expect(state.attempts).toBe(1);
  });

  it('delivers nothing twice, however many times the screen re-renders', async () => {
    await queueFor(gm);
    expect(await scoped((tx) => deliverInApp(tx, { propertyId: a.propertyId, staffUserId: gm })))
      .toBe(1);
    expect(await scoped((tx) => deliverInApp(tx, { propertyId: a.propertyId, staffUserId: gm })))
      .toBe(0);
    expect(await scoped((tx) => deliverInApp(tx, { propertyId: a.propertyId, staffUserId: gm })))
      .toBe(0);
  });

  /**
   * The reason the drainer is scoped to one person rather than one property:
   * a row that says "the duty manager has not seen this" must not be cleared
   * by the night porter opening the same console.
   */
  it('one person opening the console does not deliver somebody else\'s alerts', async () => {
    await queueFor(gm);
    await queueFor(sunita);

    await scoped((tx) => deliverInApp(tx, { propertyId: a.propertyId, staffUserId: sunita }));

    const [forGm] = await scoped((tx) =>
      notificationsFor(tx, { propertyId: a.propertyId, staffUserId: gm }));
    expect((await statusOf(forGm!.id)).status).toBe('PENDING');
  });

  it('leaves a channel it cannot deliver alone', async () => {
    await scoped((tx) => queueNotifications(tx, [{
      tenantId: a.tenantId, propertyId: a.propertyId,
      channel: 'WHATSAPP', recipientStaffId: gm,
      template: 'service_request.escalated', payload: { level: 1 },
    }]));

    const drained = await scoped((tx) =>
      deliverInApp(tx, { propertyId: a.propertyId, staffUserId: gm }));
    expect(drained).toBe(0);

    const [row] = await scoped((tx) =>
      notificationsFor(tx, { propertyId: a.propertyId, staffUserId: gm }));
    // Still a row, still PENDING, still waiting on a decision nobody has made.
    expect((await statusOf(row!.id)).status).toBe('PENDING');
  });

  /* ── Seen, and the badge ─────────────────────────────────────────────── */

  it('counts what has not been seen, and stops counting when it has', async () => {
    await queueFor(gm);
    await queueFor(gm);
    expect(await scoped((tx) =>
      unacknowledgedCount(tx, { propertyId: a.propertyId, staffUserId: gm }))).toBe(2);

    await scoped((tx) => acknowledgeAll(tx, { propertyId: a.propertyId, staffUserId: gm }));
    expect(await scoped((tx) =>
      unacknowledgedCount(tx, { propertyId: a.propertyId, staffUserId: gm }))).toBe(0);
  });

  it('acknowledging does not delete — the row is the audit trail', async () => {
    await queueFor(gm);
    await scoped((tx) => acknowledgeAll(tx, { propertyId: a.propertyId, staffUserId: gm }));

    const rows = await scoped((tx) =>
      notificationsFor(tx, { propertyId: a.propertyId, staffUserId: gm }));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.acknowledgedAt).not.toBeNull();
  });

  it('clears only this person\'s badge', async () => {
    await queueFor(gm);
    await queueFor(sunita);
    await scoped((tx) => acknowledgeAll(tx, { propertyId: a.propertyId, staffUserId: gm }));

    expect(await scoped((tx) =>
      unacknowledgedCount(tx, { propertyId: a.propertyId, staffUserId: sunita }))).toBe(1);
  });

  /**
   * The bell shows twelve rows. An unseen escalation must not be pushed off the
   * end by a fortnight of alerts somebody already dealt with — which is exactly
   * what `order by created_at` alone did.
   */
  it('puts the unseen first, however old it is', async () => {
    await queueFor(gm);
    await scoped((tx) => acknowledgeAll(tx, { propertyId: a.propertyId, staffUserId: gm }));
    const old = await scoped((tx) =>
      notificationsFor(tx, { propertyId: a.propertyId, staffUserId: gm }));
    // Make the acknowledged one the NEWEST, so chronology and seen-ness disagree.
    await owner.query(
      `UPDATE notifications SET created_at = now() + interval '1 hour' WHERE id = $1`,
      [old[0]!.id]);

    await queueFor(sunita);
    await owner.query(
      `UPDATE notifications SET recipient_staff_id = $1 WHERE recipient_staff_id = $2`,
      [gm, sunita]);

    const rows = await scoped((tx) =>
      notificationsFor(tx, { propertyId: a.propertyId, staffUserId: gm }));
    expect(rows).toHaveLength(2);
    expect(rows[0]!.acknowledgedAt).toBeNull();
    expect(rows[1]!.acknowledgedAt).not.toBeNull();
  });

  /* ── The nudge ───────────────────────────────────────────────────────── */

  it('nudges the recipient on COMMIT, and names only who should re-read', async () => {
    const received: StaffNotifiedPayload[] = [];
    let resolve!: () => void;
    const done = new Promise<void>((r) => { resolve = r; });
    const timer = setTimeout(() => resolve(), 8_000);

    const subscription = subscribeToChannel(NOTIFICATION_CHANNEL, (raw) => {
      const payload = raw as StaffNotifiedPayload;
      if (payload.recipientStaffId !== ravi) return;
      received.push(payload);
      clearTimeout(timer);
      resolve();
    });
    await subscription.ready;

    await queueFor(ravi);
    await done;
    subscription.unsubscribe();

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ propertyId: a.propertyId, recipientStaffId: ravi });
    // Routing only. Nothing about what was said travels on the wire — the bell
    // re-reads through RLS, so a subscription cannot become a way to read an
    // alert the listener could not have loaded.
    expect(Object.keys(received[0]!).sort()).toEqual(['propertyId', 'recipientStaffId']);
  });

  it('sends one nudge for two alerts queued in the same breath', async () => {
    const received: StaffNotifiedPayload[] = [];
    const subscription = subscribeToChannel(NOTIFICATION_CHANNEL, (raw) => {
      const payload = raw as StaffNotifiedPayload;
      if (payload.recipientStaffId === ravi) received.push(payload);
    });
    await subscription.ready;

    await scoped((tx) => queueNotifications(tx, [
      {
        tenantId: a.tenantId, propertyId: a.propertyId, channel: 'IN_APP',
        recipientStaffId: ravi, template: 'service_request.escalated',
        payload: { requestNumber: 'SR-1', level: 1, minutesLate: 2 },
      },
      {
        tenantId: a.tenantId, propertyId: a.propertyId, channel: 'IN_APP',
        recipientStaffId: ravi, template: 'service_request.escalated',
        payload: { requestNumber: 'SR-2', level: 1, minutesLate: 3 },
      },
    ]));

    await new Promise((r) => setTimeout(r, 1_500));
    subscription.unsubscribe();
    expect(received).toHaveLength(1);
  });

  /* ── Isolation ───────────────────────────────────────────────────────── */

  it('another hotel cannot read this hotel\'s alerts', async () => {
    await queueFor(gm);

    const leaked = await withTenant(
      { tenantId: b.tenantId, propertyId: b.propertyId },
      (tx) => notificationsFor(tx, { propertyId: a.propertyId, staffUserId: gm }),
    );
    // RLS, not the WHERE clause — the property id passed in is A's.
    expect(leaked).toEqual([]);

    const badge = await withTenant(
      { tenantId: b.tenantId, propertyId: b.propertyId },
      (tx) => unacknowledgedCount(tx, { propertyId: a.propertyId, staffUserId: gm }),
    );
    expect(badge).toBe(0);
  });

  it('another hotel cannot mark this hotel\'s alerts delivered or seen', async () => {
    await queueFor(gm);

    await withTenant({ tenantId: b.tenantId, propertyId: b.propertyId }, async (tx) => {
      await deliverInApp(tx, { propertyId: a.propertyId, staffUserId: gm });
      await acknowledgeAll(tx, { propertyId: a.propertyId, staffUserId: gm });
    });

    const [row] = await scoped((tx) =>
      notificationsFor(tx, { propertyId: a.propertyId, staffUserId: gm }));
    expect((await statusOf(row!.id)).status).toBe('PENDING');
    expect(row!.acknowledgedAt).toBeNull();
  });

  /* ── End to end, from the breach ─────────────────────────────────────── */

  /**
   * The whole chain the asterisk was about: a request breaches, the sweep
   * escalates it, a row is written for the duty manager, and the bell's own
   * read turns it into a sentence and marks it delivered.
   */
  it('a breach becomes a sentence on the duty manager\'s bell', async () => {
    const raised = await scoped(async (tx) => {
      const type = await getRequestTypeByKey(tx, { propertyId: a.propertyId, key: 'EXTRA_TOWELS' });
      return raiseServiceRequest(tx, {
        tenantId: a.tenantId, propertyId: a.propertyId, stayId, roomId: a.roomId,
        lines: [{ requestTypeId: type!.id, quantity: 1 }],
        idempotencyKey: `bell-${Math.random()}`, accessTier: 'REQUEST',
      });
    });

    await scoped((tx) => escalateBreachesFor(tx, {
      tenantId: a.tenantId,
      propertyId: a.propertyId,
      now: new Date(raised.slaTargetAt.getTime() + 11 * 60_000),
    }));

    // Exactly what src/components/alerts.tsx does, in one transaction.
    const { rows, unseen } = await scoped(async (tx) => {
      await deliverInApp(tx, { propertyId: a.propertyId, staffUserId: gm });
      return {
        rows: await notificationsFor(tx, { propertyId: a.propertyId, staffUserId: gm, limit: 12 }),
        unseen: await unacknowledgedCount(tx, { propertyId: a.propertyId, staffUserId: gm }),
      };
    });

    expect(unseen).toBe(1);
    expect(rows).toHaveLength(1);

    const rendered = renderNotification({ template: rows[0]!.template, payload: rows[0]!.payload });
    expect(rendered.title).toContain(raised.requestNumber);
    expect(rendered.title).toMatch(/minutes late$/);
    expect(rendered.body).toMatch(/Nobody has finished it/);
    expect(rendered.href).toBe('/housekeeping');

    expect((await statusOf(rows[0]!.id)).status).toBe('SENT');
  });
});
