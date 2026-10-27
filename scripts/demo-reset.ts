/**
 * `pnpm demo:reset` — wipe and reseed The Kesari. D-018.
 *
 * Run before every demo. Demo data is always seeded and resettable, never real:
 * no guest PII goes in a free-tier database.
 *
 * Idempotent and safe to run repeatedly — it truncates the demo tenant's rows
 * and rebuilds them, so a half-finished demo does not poison the next one.
 * Prints the QR codes and staff logins to stdout, because a demo where you
 * cannot find the URL is not a demo.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { withTenant, recordEvent, closePool } from '@/db';
import { dbSsl } from '@/db/ssl';
import { provisionProperty, seedSystemRoles, setStaffPassword, SYSTEM_ROLES } from '@/modules/identity';
import { seedMenu, KESARI_MENU, KESARI_CATEGORIES, KESARI_COLLECTIONS, KESARI_DEMO_COLLECTIONS, KESARI_MODIFIER_GROUPS, KESARI_ROOM_TYPES, KESARI_FLOORS, KESARI_ROOMS } from '@/modules/catalog';
import { staffUsers, staffPropertyRoles, rooms as roomsTable } from '@/db/schema/identity';
import { createStay } from '@/modules/stay';
import { createVisitLink } from '@/modules/visit';
import { menuItems, outlets } from '@/db/schema/catalog';
import { orders, orderItems } from '@/db/schema/ordering';
import { serviceRequests, serviceRequestItems, requestTypes } from '@/db/schema/requests';
import { pois } from '@/db/schema/concierge';
import { checkoutFeeTiers } from '@/db/schema/stay';
import { escalateBreachesFor } from '@/modules/requests';
import { folios, folioLines } from '@/db/schema/billing';
import { formatMoney, money } from '@/lib/money';
import { and, eq } from 'drizzle-orm';

/** Fixed so the demo tenant is identifiable in a shared database. All hex —
 *  an earlier value used 'm', which is not a hex digit and is not a uuid. */
const TENANT_ID = 'deadbeef-0000-4000-8000-000000000001';

/**
 * How long the seeded guests stay. See the note where `checkout` is computed:
 * this is the number that decides how often the public `/demo` link goes dark.
 */
const DEMO_STAY_NIGHTS = 14;

/**
 * The demo property's QR codes, and why they are not random.
 *
 * A real sticker's code must be unguessable — see `publicCodeFor` in
 * `modules/identity/provision.ts`. This property is the one exception, and it
 * earns it: the data is invented, the marketing site has a public button that
 * walks anyone straight into it, and there is nothing to guess.
 *
 * What a random code costs here is real. Every `demo:reset` reissued all 34,
 * which broke every link previously written down or sent to somebody —
 * including the four printed in `docs/STATUS.md`, twice in one week, and
 * eventually as a reported bug. `kesari-214` survives a reseed, survives a
 * rebuild of the database, and can be typed from memory.
 */
function demoPublicCode(roomNumber: string): string {
  return `${PROPERTY_SLUG}-${roomNumber}`;
}


/**
 * Udaipur, in the GM's voice.
 *
 * The editorial note is the product here (see the header of
 * `db/schema/concierge.ts`): a curated list beats a Google Maps embed
 * precisely because somebody who knows the city wrote it. These read like a
 * person who has walked the distance, because that is the bar a real property
 * has to clear when it fills this in.
 *
 * Walking times are from the haveli, and plausible rather than measured —
 * nothing computes them yet. P4's nightly job is what makes them true, and
 * until it exists the guest screen says so.
 *
 * `category` drives which part of the day a place lands in, via
 * `partForCategory()` in modules/concierge. It is not a second time-of-day
 * field; see that file for why there isn't one.
 */
const KESARI_POIS = [
  { name: 'Jagdish Temple', category: 'TEMPLE', walk: 6,
    note: 'Go at seven, before the steps fill. The bells start at quarter past and the marble is still cold.' },
  { name: 'Gangaur Ghat', category: 'GHAT', walk: 4,
    note: 'Where the city washes and gossips. Third step down, facing out — the light comes off the lake at about eight.' },
  { name: 'Jheel’s Ginger Coffee Bar', category: 'CAFE', walk: 5,
    note: 'Two floors up, four tables, the best coffee within walking distance. They open at eight and they do not hurry.' },
  { name: 'City Palace', category: 'PALACE', walk: 9,
    note: 'Two hours if you read the labels, forty minutes if you don’t. Buy the ticket for the museum as well; you will want it.' },
  { name: 'Bagore Ki Haveli', category: 'MUSEUM', walk: 5,
    note: 'Smaller than the palace and better for it. The glass and mirror room on the first floor is the one people photograph.' },
  { name: 'Hathi Pol Bazaar', category: 'SHOPPING', walk: 11,
    note: 'Miniature painting and puppets. Ask for Kamal at the third shop on the left and say the hotel sent you.' },
  { name: 'Ambrai Ghat', category: 'VIEWPOINT', walk: 12,
    note: 'The view of the palace everyone has seen. Be there forty minutes before sunset or you will be standing behind somebody.' },
  { name: 'Dharohar at Bagore Ki Haveli', category: 'EXPERIENCE', walk: 5,
    note: 'Folk dance at seven, one hour, no interval. The bhavai — the woman with the pots on her head — is worth the ticket alone.' },
  { name: 'Upre by 1559 AD', category: 'DINING', walk: 8, partner: true,
    offer: 'A table on the roof held until 9pm for our guests',
    note: 'Rooftop, lake on three sides. Tell them you are staying with us and they will find you a table at the edge.' },
  { name: 'Millets of Mewar', category: 'DINING', walk: 14,
    note: 'Unfashionable, entirely vegetarian, and the best thali in the old city. Cash is easier than card.' },
  { name: 'Sunset Terrace', category: 'BAR', walk: 10,
    note: 'One drink, at the hour it is named for. Overpriced and worth it exactly once per stay.' },
  { name: 'Sajjangarh Monsoon Palace', category: 'VIEWPOINT', walk: null, drive: 25,
    note: 'Twenty-five minutes up the hill and the whole lake laid out below. The desk can arrange a car; go for sunset, not for the building.' },
] as const;
const TENANT_SLUG = 'kesari-demo';
const PROPERTY_SLUG = 'the-kesari';

/**
 * The demo's property links — the restaurant half of the product (D-079).
 *
 * Three, because three is what it takes to show that a link's KIND is the
 * thing that decides the flow: a tent that knows its own table, a till that
 * does not, and a link somebody sends where the customer picks.
 *
 * Stable codes for the same reason the room stickers have them, and with the
 * same single exception: see `createVisitLink`'s `publicCode`.
 */
const DEMO_LINKS = [
  {
    code: `${PROPERTY_SLUG}-table-4`,
    kind: 'TABLE' as const,
    label: 'Courtyard 4',
    tableLabel: 'Courtyard 4',
  },
  {
    code: `${PROPERTY_SLUG}-counter`,
    kind: 'COUNTER' as const,
    label: 'Front counter',
    tableLabel: null,
  },
  {
    code: `${PROPERTY_SLUG}-order`,
    kind: 'ONLINE' as const,
    label: 'Instagram bio',
    tableLabel: null,
  },
];
const DEMO_PASSWORD = 'kesari-demo-2026';
const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

/**
 * The four in-house guests. Module scope because the seed artifact written at
 * the end needs their last four digits — that is what the e2e suite answers the
 * verification prompt with (D-012).
 *
 * ─── Why room 210 exists ───────────────────────────────────────────────────
 *
 * Verification is rate-limited per ROOM: five attempts in thirty minutes,
 * counted across challenges (`assertNotLockedOut`, DATA-MODEL §3). The e2e
 * suite's ordering and amenities tests already spend four of room 214's, so a
 * suite that also verifies there locks the room out and fails on the rate
 * limiter working exactly as designed.
 *
 * Rooms are a shared resource in that suite the way carts already are, and the
 * fix is the same one: another room. 210 belongs to the stay screen's tests and
 * to nothing else, which is why it has a folio of its own below.
 */
const DEMO_GUESTS = [
  { name: 'Anjali Menon',   phone: '+919820011111', room: '214' },
  { name: 'Thomas Beckett', phone: '+919820022222', room: '105' },
  { name: 'Rhea Kapoor',    phone: '+919820033333', room: '301' },
  { name: 'Iqbal Qureshi',  phone: '+919820044444', room: '210' },
];

const DEMO_STAFF = [
  { email: 'gm@thekesari.example',        name: 'Vikram Rathore',  role: 'PROPERTY_ADMIN' },
  { email: 'frontdesk@thekesari.example', name: 'Anjali Sharma',   role: 'FRONT_DESK' },
  { email: 'fnb@thekesari.example',       name: 'Meera Joshi',     role: 'F_AND_B_MANAGER' },
  { email: 'kitchen@thekesari.example',   name: 'Chef Bhairav',    role: 'KITCHEN' },
  { email: 'runner@thekesari.example',    name: 'Ravi Kumar',      role: 'RUNNER' },
  { email: 'housekeeping@thekesari.example', name: 'Sunita Devi',  role: 'HOUSEKEEPING' },
] as const;

/**
 * Every tenant-scoped table. ORDER DOES NOT MATTER — see wipe().
 *
 * It used to, and the list was wrong: `guest_sessions` sat before
 * `access_escalations`, which references it. Nothing noticed for three sessions
 * because nothing had ever written an escalation row. The moment D-012 was
 * wired up, `pnpm demo:reset` started failing with a foreign key violation
 * naming a constraint rather than the mistake.
 *
 * The integration fixtures hit this twice and stopped hand-ordering; this list
 * now only has to be COMPLETE, which a missing entry makes obvious (rows
 * survive the reset) rather than silent.
 */
const WIPE_ORDER = [
  'event_log', 'order_item_modifiers', 'order_items', 'orders',
  'cart_item_modifiers', 'cart_items', 'carts',
  // D-079. Before `outlets` and `guests`, both of which they reference —
  // though the order genuinely does not matter, see the note above.
  'visits', 'visit_links',
  'service_request_items', 'service_requests',
  'folio_lines', 'folios', 'payments',
  'checkout_requests', 'guest_sessions', 'access_escalations',
  'verification_challenges', 'staff_vouches', 'access_policies',
  'itinerary_stops', 'itineraries', 'pois', 'notifications',
  'menu_item_daily_sales', 'menu_offers', 'collection_items', 'collections', 'menu_item_availability_windows',
  'menu_item_modifier_groups', 'modifier_options', 'modifier_groups',
  'menu_items', 'menu_categories', 'outlet_hours', 'outlets',
  'request_types', 'shift_zones', 'shifts',
  'stays', 'guest_property_profiles', 'guests',
  'room_qr_codes', 'rooms', 'floors', 'room_types',
  'staff_sessions', 'staff_property_roles', 'role_permissions', 'roles', 'staff_users',
  'idempotency_keys', 'integration_outbox', 'properties',
];

async function wipe(): Promise<void> {
  const owner = new pg.Client({
    connectionString: process.env.DATABASE_MIGRATION_URL,
    ssl: dbSsl(process.env.DATABASE_MIGRATION_URL),
  });
  await owner.connect();
  try {
    /**
     * FK triggers are suspended for this connection, the same way the
     * integration fixtures do it — so the delete order cannot be wrong.
     *
     * `session_replication_role = replica` is owner-only, this script already
     * connects as the owner, and it is restored immediately. The application
     * may never do this; a dev script that wipes one hardcoded demo tenant is
     * exactly where it belongs.
     *
     * One statement, not fifty round trips. TENANT_ID is a constant in this
     * file, never user input, so interpolating it is safe — and pg does not
     * allow parameters in a multi-statement query anyway.
     */
    await owner.query(`SET session_replication_role = replica`);
    const statements = WIPE_ORDER
      .map((t) => `DELETE FROM ${t} WHERE tenant_id = '${TENANT_ID}';`)
      .join('\n');
    await owner.query(`${statements}\nDELETE FROM tenants WHERE id = '${TENANT_ID}';`);
  } finally {
    await owner.query(`SET session_replication_role = origin`).catch(() => {});
    await owner.end();
  }
}

async function main(): Promise<void> {
  console.log('\n  Resetting The Kesari demo…\n');
  await wipe();

  // Tenant creation cannot be inside withTenant — you cannot set app.tenant_id
  // to a tenant that does not exist yet. Everything after it is scoped.
  const owner = new pg.Client({
    connectionString: process.env.DATABASE_MIGRATION_URL,
    ssl: dbSsl(process.env.DATABASE_MIGRATION_URL),
  });
  await owner.connect();
  await owner.query(
    `INSERT INTO tenants (id, name, slug, status) VALUES ($1, 'The Kesari', $2, 'ACTIVE')`,
    [TENANT_ID, TENANT_SLUG]);
  await owner.end();

  const result = await withTenant({ tenantId: TENANT_ID }, async (tx) => {
    const provisioned = await provisionProperty(tx, {
      tenantId: TENANT_ID,
      name: 'The Kesari',
      slug: PROPERTY_SLUG,
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      city: 'Udaipur',
      roomTypes: KESARI_ROOM_TYPES,
      floors: KESARI_FLOORS,
      rooms: KESARI_ROOMS,
      adminEmail: 'gm@thekesari.example',
      adminName: 'Vikram Rathore',
      publicCodeFor: demoPublicCode,
    });

    const menu = await seedMenu(tx, {
      tenantId: TENANT_ID,
      propertyId: provisioned.propertyId,
      outletId: provisioned.outletId,
      categories: KESARI_CATEGORIES,
      items: KESARI_MENU,
      collections: [...KESARI_COLLECTIONS, ...KESARI_DEMO_COLLECTIONS],
      modifierGroups: KESARI_MODIFIER_GROUPS,
    });

    /**
     * The property links. After the menu, because each one points at an outlet
     * and there is no outlet to point at until `seedMenu` has run.
     *
     * `createVisitLink()` rather than a direct insert, for the reason every
     * other seeder call here does it: it is the one door (D-079), and a seeder
     * that writes the row itself is the first caller to drift.
     */
    for (const link of DEMO_LINKS) {
      await createVisitLink(tx, {
        tenantId: TENANT_ID,
        propertyId: provisioned.propertyId,
        outletId: provisioned.outletId,
        kind: link.kind,
        label: link.label,
        tableLabel: link.tableLabel,
        publicCode: link.code,
      });
    }

    // ── Staff, all with the same demo password ──────────────────────────────
    const roleIds = await seedSystemRoles(tx, TENANT_ID);
    for (const person of DEMO_STAFF) {
      const existing = await tx.select({ id: staffUsers.id }).from(staffUsers)
        .where(and(eq(staffUsers.tenantId, TENANT_ID), eq(staffUsers.email, person.email))).limit(1);
      const id = existing[0]?.id ?? (await tx.insert(staffUsers).values({
        tenantId: TENANT_ID, email: person.email, fullName: person.name, status: 'ACTIVE',
      }).returning({ id: staffUsers.id }))[0]!.id;
      await setStaffPassword(tx, id, DEMO_PASSWORD);
      const hasRole = await tx.select({ id: staffPropertyRoles.id }).from(staffPropertyRoles)
        .where(and(
          eq(staffPropertyRoles.staffUserId, id),
          eq(staffPropertyRoles.propertyId, provisioned.propertyId),
        )).limit(1);
      if (!hasRole[0]) {
        await tx.insert(staffPropertyRoles).values({
          tenantId: TENANT_ID, staffUserId: id,
          propertyId: provisioned.propertyId,
          roleId: roleIds.get(person.role as keyof typeof SYSTEM_ROLES)!,
        });
      }
    }

    /**
     * ── What the desk sells at the end of a stay ─────────────────────────
     *
     * Hours, not nights. The reference offers "Stay Thursday night, ₹18,500"
     * and pricing a night needs a rate plan, which is v2 booking (D-033) — so
     * the demo offers the two late checkouts and nothing else.
     *
     * The notes are the reference's own words where it has them; the titles and
     * the durations are derived, so one row reads correctly for a guest due out
     * at 11am and for one due out at 1pm.
     */
    await tx.insert(checkoutFeeTiers).values([
      { hour: 14, note: null, feeMinor: 250_000, sortOrder: 0 },
      { hour: 18, note: 'The room is yours all day', feeMinor: 500_000, sortOrder: 1 },
    ].map((tier) => ({
      tenantId: TENANT_ID,
      propertyId: provisioned.propertyId,
      hour: tier.hour,
      note: tier.note,
      feeMinor: tier.feeMinor,
      sortOrder: tier.sortOrder,
    })));

    // ── Four in-house stays ─────────────────────────────────────────────────
    const stayIds = new Map<string, string>();
    for (const g of DEMO_GUESTS) {
      // Loud rather than a NOT NULL violation forty lines later.
      if (!provisioned.roomIds.has(g.room)) {
        throw new Error(
          `Demo references room ${g.room}, which KESARI_ROOMS does not create. ` +
          `Available: ${[...provisioned.roomIds.keys()].join(', ')}`);
      }
      /*
        11am, property-local, DEMO_STAY_NIGHTS from now. Rendered in
        properties.timezone, never the server's — CLAUDE.md "Dates".

        This used to be two nights, which is what a plausible stay looks like
        and was right while the seed only ever served a laptop. It is not right
        any more: `/demo` on the marketing site opens this property, and a
        two-night stay means the public demo link dies every second day with no
        warning to anybody. It died once, an hour after the last deploy, and the
        only reason it was noticed is that a verification run happened to be
        pointed at it.

        Fourteen nights is the compromise. Long enough that reseeding is a
        fortnightly chore rather than a daily outage, short enough that the
        guest screen still reads as a stay rather than a tenancy. The real fix
        is a scheduled reseed; this buys the time to do it properly.
      */
      const checkout = new Date();
      checkout.setDate(checkout.getDate() + DEMO_STAY_NIGHTS);
      checkout.setHours(11, 0, 0, 0);

      // Through createStay(), like the front desk and the PMS import — #4.
      // The seeder used to insert the guest and the stay itself, which meant
      // the demo exercised a shape nothing in production ever creates.
      const created = await createStay(tx, {
        tenantId: TENANT_ID,
        propertyId: provisioned.propertyId,
        roomId: provisioned.roomIds.get(g.room)!,
        guest: { fullName: g.name, phone: g.phone },
        status: 'CHECKED_IN',
        source: 'FRONT_DESK',
        checkedInAt: new Date(Date.now() - 86_400_000),
        scheduledCheckoutAt: checkout,
      });
      stayIds.set(g.room, created.stayId);
    }

    // ── Two in-flight orders, at different states ───────────────────────────
    const items = await tx.select({ id: menuItems.id, name: menuItems.name, priceMinor: menuItems.priceMinor })
      .from(menuItems).where(eq(menuItems.outletId, provisioned.outletId));
    const byName = new Map(items.map((i) => [i.name, i]));
    const pick = (n: string) => byName.get(n)!;

    const orderSpecs = [
      { room: '214', number: 'KE-1184', status: 'PREPARING' as const,
        lines: ['Laal maas with bajra roti', 'Ker sangri', 'Masala chai'] },
      { room: '105', number: 'KE-1185', status: 'PLACED' as const,
        lines: ['Dal baati churma', 'Kesar lassi'] },
    ];
    for (const spec of orderSpecs) {
      const lines = spec.lines.map(pick);
      const subtotal = lines.reduce((n, l) => n + l.priceMinor, 0);
      const tax = Math.round(subtotal * 0.05);
      const [order] = await tx.insert(orders).values({
        tenantId: TENANT_ID, propertyId: provisioned.propertyId,
        stayId: stayIds.get(spec.room)!, outletId: provisioned.outletId,
        orderNumber: spec.number, status: spec.status,
        // D-079 — what the kitchen ticket says. `placeOrder()` snapshots this
        // on every real order; this seeder writes the row directly, so it has
        // to say it too. Without it the two seeded tickets render as a dash on
        // a KDS otherwise full of correct destinations.
        fulfilment: 'IN_ROOM', destinationLabel: `Room ${spec.room}`,
        subtotalMinor: subtotal, taxMinor: tax, totalMinor: subtotal + tax,
        placedAt: new Date(Date.now() - 15 * 60_000),
        acceptedAt: spec.status === 'PREPARING' ? new Date(Date.now() - 12 * 60_000) : null,
        preparingAt: spec.status === 'PREPARING' ? new Date(Date.now() - 10 * 60_000) : null,
        promisedByAt: new Date(Date.now() + 18 * 60_000),
      }).returning({ id: orders.id });

      for (const line of lines) {
        // #6 — the receipt renders from the snapshot, never the live catalog row.
        await tx.insert(orderItems).values({
          tenantId: TENANT_ID, orderId: order!.id, menuItemId: line.id,
          nameSnapshot: line.name, unitPriceMinor: line.priceMinor,
          quantity: 1, lineTotalMinor: line.priceMinor,
        });
      }
      await recordEvent(tx, {
        tenantId: TENANT_ID, propertyId: provisioned.propertyId,
        entityType: 'order', entityId: order!.id,
        eventType: 'order.placed', toStatus: spec.status,
        actor: { kind: 'SYSTEM' },
      });
    }

    // ── One open service request ────────────────────────────────────────────
    const towels = await tx.select({ id: requestTypes.id, name: requestTypes.name, slaMinutes: requestTypes.slaMinutes })
      .from(requestTypes)
      .where(and(eq(requestTypes.propertyId, provisioned.propertyId), eq(requestTypes.key, 'EXTRA_TOWELS')))
      .limit(1);
    const room214 = await tx.select({ floorId: roomsTable.floorId }).from(roomsTable)
      .where(eq(roomsTable.id, provisioned.roomIds.get('214')!)).limit(1);
    const [seededRequest] = await tx.insert(serviceRequests).values({
      tenantId: TENANT_ID, propertyId: provisioned.propertyId,
      stayId: stayIds.get('214')!, floorId: room214[0]!.floorId,
      requestTypeId: towels[0]!.id,
      requestNumber: 'SR-4471', status: 'OPEN',
      guestNote: 'Two extra towels please',
      slaTargetAt: new Date(Date.now() + towels[0]!.slaMinutes * 60_000),
    }).returning({ id: serviceRequests.id });

    /**
     * With its line, which it did not have.
     *
     * A request with no `service_request_items` renders on the floor board as a
     * room number and a note and nothing to bring — the demo's own screen made
     * that obvious the first time it was looked at. Every request a guest raises
     * has lines (`raiseServiceRequest` snapshots them, #6); the seeded one has
     * to as well or the demo shows a shape the product never produces.
     */
    await tx.insert(serviceRequestItems).values({
      tenantId: TENANT_ID,
      serviceRequestId: seededRequest!.id,
      requestTypeId: towels[0]!.id,
      labelSnapshot: towels[0]!.name,
      unitPriceMinor: 0,
      quantity: 2,
      lineTotalMinor: 0,
    });

    /**
     * ── And one that is already late ──────────────────────────────────────
     *
     * A wake-up call, promised in five minutes and now fourteen minutes past.
     *
     * The demo needs it. Everything else on the floor board is inside its
     * promise, so the SLA worker, the red countdown and the duty manager's
     * bell — the whole second half of P2 — had nothing to show unless somebody
     * sat watching a screen for a quarter of an hour first.
     *
     * Escalated by calling the sweep's own function rather than writing
     * `escalation_level` and a notification row by hand. A seeder that
     * hand-rolls what the product does is a seeder that keeps working after the
     * product breaks (setup.ts learned this, and now calls
     * `provisionProperty()` for the same reason). Fourteen minutes late is
     * level 2 in one step: the assignee is told and so is the duty manager, and
     * level 3 is not due for another sixteen minutes.
     */
    const wakeUp = await tx.select({ id: requestTypes.id, name: requestTypes.name })
      .from(requestTypes)
      .where(and(eq(requestTypes.propertyId, provisioned.propertyId), eq(requestTypes.key, 'WAKE_UP_CALL')))
      .limit(1);
    const room105 = await tx.select({ floorId: roomsTable.floorId }).from(roomsTable)
      .where(eq(roomsTable.id, provisioned.roomIds.get('105')!)).limit(1);
    const [lateRequest] = await tx.insert(serviceRequests).values({
      tenantId: TENANT_ID, propertyId: provisioned.propertyId,
      stayId: stayIds.get('105')!, floorId: room105[0]!.floorId,
      requestTypeId: wakeUp[0]!.id,
      requestNumber: 'SR-4468', status: 'OPEN',
      guestNote: 'For 6am, I have a train.',
      slaTargetAt: new Date(Date.now() - 14 * 60_000),
    }).returning({ id: serviceRequests.id });

    await tx.insert(serviceRequestItems).values({
      tenantId: TENANT_ID,
      serviceRequestId: lateRequest!.id,
      requestTypeId: wakeUp[0]!.id,
      labelSnapshot: wakeUp[0]!.name,
      unitPriceMinor: 0,
      quantity: 1,
      lineTotalMinor: 0,
    });

    const escalated = await escalateBreachesFor(tx, {
      tenantId: TENANT_ID,
      propertyId: provisioned.propertyId,
      now: new Date(),
    });

    // ── A partially populated folio for room 214 ────────────────────────────
    const [folio] = await tx.insert(folios).values({
      tenantId: TENANT_ID, propertyId: provisioned.propertyId,
      stayId: stayIds.get('214')!, status: 'OPEN',
    }).returning({ id: folios.id });

    const folioSeed = [
      { description: 'Room charge · Lake view', amountMinor: 1_800_000, source: 'MANUAL' as const },
      { description: 'In-room dining · KE-1180', amountMinor: 247_000, source: 'ORDER' as const },
      { description: 'Laundry service', amountMinor: 45_000, source: 'SERVICE_REQUEST' as const },
      { description: 'Minibar', amountMinor: 62_000, source: 'MANUAL' as const },
    ];
    for (const line of folioSeed) {
      await tx.insert(folioLines).values({
        tenantId: TENANT_ID, propertyId: provisioned.propertyId,
        folioId: folio!.id, source: line.source,
        description: line.description, amountMinor: line.amountMinor,
      });
    }

    /**
     * ── A second folio, on room 210 ──────────────────────────────────────
     *
     * Two lines rather than four, and no minibar: it is the shorter bill a
     * guest on their second night actually has, and the stay screen's e2e reads
     * it rather than 214's for the rate-limit reason in DEMO_GUESTS above.
     *
     * It also gives the demo two folios to compare, which is the point at which
     * "the guest can see what they have spent" stops being one screenshot.
     */
    const [folio210] = await tx.insert(folios).values({
      tenantId: TENANT_ID, propertyId: provisioned.propertyId,
      stayId: stayIds.get('210')!, status: 'OPEN',
    }).returning({ id: folios.id });

    for (const line of [
      { description: 'Room charge · Lake view', amountMinor: 1_200_000, source: 'MANUAL' as const },
      { description: 'In-room dining · KE-1179', amountMinor: 118_000, source: 'ORDER' as const },
    ]) {
      await tx.insert(folioLines).values({
        tenantId: TENANT_ID, propertyId: provisioned.propertyId,
        folioId: folio210!.id, source: line.source,
        description: line.description, amountMinor: line.amountMinor,
      });
    }

    const totals = await tx.select({ balanceMinor: folios.balanceMinor })
      .from(folios).where(eq(folios.id, folio!.id)).limit(1);

    /*
      The concierge list. Read-only in the product so far — there is no screen
      that adds one of these yet — but it is real data in the real table, which
      is what lets the guest screen be a screen rather than a mock.
    */
    await tx.insert(pois).values(KESARI_POIS.map((poi, i) => ({
      tenantId: TENANT_ID,
      propertyId: provisioned.propertyId,
      name: poi.name,
      category: poi.category,
      editorialNote: poi.note,
      walkMinutes: poi.walk ?? null,
      driveMinutes: 'drive' in poi ? poi.drive : null,
      isPartner: 'partner' in poi ? poi.partner : false,
      partnerOffer: 'offer' in poi ? poi.offer : null,
      sortOrder: i,
    })));

    const outletRow = await tx.select({ id: outlets.id }).from(outlets)
      .where(eq(outlets.id, provisioned.outletId)).limit(1);

    return {
      provisioned, menu, escalated,
      folioBalance: totals[0]?.balanceMinor ?? 0, outlet: outletRow[0]!.id,
    };
  });

  const { provisioned, menu, folioBalance, escalated } = result;

  console.log('  ✓ The Kesari — 34-key haveli, Udaipur\n');
  console.log(`    property      ${provisioned.propertyId}`);
  console.log(`    rooms         ${provisioned.roomIds.size} across ${KESARI_FLOORS.length} floors`);
  console.log(`    menu          ${menu.items} dishes in ${menu.categories} categories, ${menu.collections} collections`);
  console.log(`    modifiers     ${menu.modifierGroups} groups`);
  console.log(`    request types ${provisioned.requestTypeCount}`);
  console.log(`    folio 214     ${formatMoney(money(folioBalance, 'INR'))} across 4 lines`);
  console.log(`    late request  SR-4468, 14 minutes past — ${escalated} escalated, the GM's bell is lit`);
  console.log('    folio 210     ₹13,180 across 2 lines');
  console.log('    late checkout 2pm ₹2,500 · 6pm ₹5,000 — the desk decides at /admin/checkouts');
  console.log(`    nearby        ${KESARI_POIS.length} places, in the GM's voice — the guest's "Plan my day"`);
  console.log('\n  Staff logins  (password for all: ' + DEMO_PASSWORD + ')');
  for (const s of DEMO_STAFF) console.log(`    ${s.role.padEnd(16)} ${s.email}`);

  console.log('\n  Scan these  (guest PWA, no login, no verification — D-012)');
  for (const room of ['214', '105', '301', '210']) {
    console.log(`    room ${room}  ${APP_URL}/r/${provisioned.qrCodes.get(room)}`);
  }
  console.log(`\n  ${provisioned.qrCodes.size} QR codes total. Orders KE-1184 (preparing) and KE-1185 (placed) are live.`);

  console.log('\n  Open these  (property links — no room, no stay, pay at the counter)');
  for (const link of DEMO_LINKS) {
    console.log(`    ${link.label.padEnd(15)} ${APP_URL}/p/${link.code}`);
  }
  console.log('');

  /**
   * The same facts, machine-readable, for the e2e suite.
   *
   * QR codes are regenerated on every reset and must never be cached — so the
   * e2e tests cannot hardcode one, and they cannot open a database connection
   * either (they run in Playwright's process, outside the app). This file is
   * the handoff. It is gitignored: it holds live codes for whatever database
   * was just seeded.
   */
  writeFileSync(
    join(process.cwd(), '.demo-seed.json'),
    JSON.stringify(
      {
        appUrl: APP_URL,
        tenantId: TENANT_ID,
        propertyId: provisioned.propertyId,
        qrCodes: Object.fromEntries(provisioned.qrCodes),
        // D-079 — the property links, for the e2e that orders without a room.
        visitLinks: Object.fromEntries(DEMO_LINKS.map((l) => [l.kind, l.code])),
        // The e2e suite needs these to answer the one verification prompt
        // (D-012). Demo data, in a gitignored file, for a demo property.
        guests: Object.fromEntries(
          DEMO_GUESTS.map((g) => [g.room, {
            name: g.name,
            phoneLast4: g.phone.replace(/\D/g, '').slice(-4),
          }]),
        ),
        staffPassword: DEMO_PASSWORD,
        staff: DEMO_STAFF.map((s) => ({ role: s.role, email: s.email })),
      },
      null,
      2,
    ) + '\n',
  );

  await closePool();
}

await main();
