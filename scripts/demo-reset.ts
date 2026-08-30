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
import { seedMenu, KESARI_MENU, KESARI_CATEGORIES, KESARI_COLLECTIONS, KESARI_MODIFIER_GROUPS, KESARI_ROOM_TYPES, KESARI_FLOORS, KESARI_ROOMS } from '@/modules/catalog';
import { staffUsers, staffPropertyRoles, rooms as roomsTable } from '@/db/schema/identity';
import { createStay } from '@/modules/stay';
import { menuItems, outlets } from '@/db/schema/catalog';
import { orders, orderItems } from '@/db/schema/ordering';
import { serviceRequests, requestTypes } from '@/db/schema/requests';
import { folios, folioLines } from '@/db/schema/billing';
import { formatMoney, money } from '@/lib/money';
import { and, eq } from 'drizzle-orm';

/** Fixed so the demo tenant is identifiable in a shared database. All hex —
 *  an earlier value used 'm', which is not a hex digit and is not a uuid. */
const TENANT_ID = 'deadbeef-0000-4000-8000-000000000001';
const TENANT_SLUG = 'kesari-demo';
const PROPERTY_SLUG = 'the-kesari';
const DEMO_PASSWORD = 'kesari-demo-2026';
const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

/**
 * The three in-house guests. Module scope because the seed artifact written at
 * the end needs their last four digits — that is what the e2e suite answers the
 * verification prompt with (D-012).
 */
const DEMO_GUESTS = [
  { name: 'Anjali Menon',   phone: '+919820011111', room: '214' },
  { name: 'Thomas Beckett', phone: '+919820022222', room: '105' },
  { name: 'Rhea Kapoor',    phone: '+919820033333', room: '301' },
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
  'service_request_items', 'service_requests',
  'folio_lines', 'folios', 'payments',
  'checkout_requests', 'guest_sessions', 'access_escalations',
  'verification_challenges', 'staff_vouches', 'access_policies',
  'itinerary_stops', 'itineraries', 'pois', 'notifications',
  'collection_items', 'collections', 'menu_item_availability_windows',
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
    });

    const menu = await seedMenu(tx, {
      tenantId: TENANT_ID,
      propertyId: provisioned.propertyId,
      outletId: provisioned.outletId,
      categories: KESARI_CATEGORIES,
      items: KESARI_MENU,
      collections: KESARI_COLLECTIONS,
      modifierGroups: KESARI_MODIFIER_GROUPS,
    });

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

    // ── Three in-house stays ────────────────────────────────────────────────
    const stayIds = new Map<string, string>();
    for (const g of DEMO_GUESTS) {
      // Loud rather than a NOT NULL violation forty lines later.
      if (!provisioned.roomIds.has(g.room)) {
        throw new Error(
          `Demo references room ${g.room}, which KESARI_ROOMS does not create. ` +
          `Available: ${[...provisioned.roomIds.keys()].join(', ')}`);
      }
      // Thursday 11am, property-local. Rendered in properties.timezone, never
      // the server's — CLAUDE.md "Dates".
      const checkout = new Date();
      checkout.setDate(checkout.getDate() + 2);
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
    await tx.insert(serviceRequests).values({
      tenantId: TENANT_ID, propertyId: provisioned.propertyId,
      stayId: stayIds.get('214')!, floorId: room214[0]!.floorId,
      requestTypeId: towels[0]!.id,
      requestNumber: 'SR-4471', status: 'OPEN',
      guestNote: 'Two extra towels please',
      slaTargetAt: new Date(Date.now() + towels[0]!.slaMinutes * 60_000),
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

    const totals = await tx.select({ balanceMinor: folios.balanceMinor })
      .from(folios).where(eq(folios.id, folio!.id)).limit(1);

    const outletRow = await tx.select({ id: outlets.id }).from(outlets)
      .where(eq(outlets.id, provisioned.outletId)).limit(1);

    return { provisioned, menu, folioBalance: totals[0]?.balanceMinor ?? 0, outlet: outletRow[0]!.id };
  });

  const { provisioned, menu, folioBalance } = result;

  console.log('  ✓ The Kesari — 34-key haveli, Udaipur\n');
  console.log(`    property      ${provisioned.propertyId}`);
  console.log(`    rooms         ${provisioned.roomIds.size} across ${KESARI_FLOORS.length} floors`);
  console.log(`    menu          ${menu.items} dishes in ${menu.categories} categories, ${menu.collections} collections`);
  console.log(`    modifiers     ${menu.modifierGroups} groups`);
  console.log(`    request types ${provisioned.requestTypeCount}`);
  console.log(`    folio 214     ${formatMoney(money(folioBalance, 'INR'))} across 4 lines`);
  console.log('\n  Staff logins  (password for all: ' + DEMO_PASSWORD + ')');
  for (const s of DEMO_STAFF) console.log(`    ${s.role.padEnd(16)} ${s.email}`);

  console.log('\n  Scan these  (guest PWA, no login, no verification — D-012)');
  for (const room of ['214', '105', '301']) {
    console.log(`    room ${room}  ${APP_URL}/r/${provisioned.qrCodes.get(room)}`);
  }
  console.log(`\n  ${provisioned.qrCodes.size} QR codes total. Orders KE-1184 (preparing) and KE-1185 (placed) are live.\n`);

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
