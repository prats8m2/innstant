# Extension points — keeping v2 booking cheap

The booking module is **not** in the schema. This document is the contract that
keeps it a two-week integration in v2 instead of a three-month migration.

The rule applied throughout: **keep the changes that would require reconciling
existing data later; drop everything that is purely additive.**

In Postgres, adding a table, adding a nullable column, and adding an enum value
are all effectively free and online. Changing a unique constraint on a populated
table, or backfilling a varchar into a foreign key across live rooms, is a
migration with a maintenance window and a reconciliation script that someone has
to write at 2am.

---

## What was kept, and why

### 1. `room_types` is a real table

`rooms.room_type` is a `room_type_id` FK, not a varchar.

*Cost now:* one extra table, and a room-type picker in the admin panel. The GM
wanted that anyway — "Deluxe Lake View" belongs in a dropdown, not a free-text
field where three staff members spell it three ways.

*Cost if deferred:* rates and inventory are priced per room type, never per
physical room, so booking cannot exist without this table. Adding it later means
reading every distinct varchar across every property, deciding which are the
same type, creating rows, backfilling FKs, and reconciling the typos. On live
data, across N hotels. This is the single most expensive thing you could defer.

### 2. `guests` is tenant-scoped, with `guest_property_profiles` alongside

Unique key is `(tenant_id, phone)`, not `(property_id, phone)`.

*Cost now:* one extra join for property-specific data (VIP flag, staff notes,
charging block, lifetime value).

*Cost if deferred:* a person books before they arrive, and may book across a
group's properties. Widening the scope later means merging duplicate guest rows
that already exist under different properties, then repointing every order,
request, stay and folio at the survivor. There is no clean automated answer to
"are these two Anjali Menons the same person" once the data is real.

### 3. `stays.source` + `stays.source_ref_id`

A discriminator and an opaque pointer. Today: `WALK_IN`, `FRONT_DESK`,
`PMS_IMPORT`. `source_ref_id` holds the PMS reservation id.

*Cost now:* two columns and the discipline described below.

*Why it matters:* it forces the branch to exist. A booking module adds one enum
value and one caller, rather than introducing the first-ever notion that stays
have different origins.

---

## The four disciplines that actually do the work

Schema seams are the easy part. These are the ones that will decay if nobody
watches them.

### A. One `createStay()`, always

Every stay in the system is created by exactly one service function. Front desk,
PMS import, and the seeder all call it. Nothing inserts into `stays` directly.

When booking arrives, it becomes a fourth caller. If instead stay creation is
scattered across six route handlers, adding booking means finding all six and
reasoning about each — and you will miss one, and it will be the one that skips
folio creation.

**Enforce it:** the `stays` table is only importable from `modules/stay/`. Add an
ESLint `no-restricted-imports` rule. This is worth the twenty minutes.

### B. `PmsAdapter` is the boundary — and booking is just another implementation

This is the important one.

Everything outside `modules/stay/` talks to reservations through one interface:

```ts
interface PmsAdapter {
  findStayByRoom(propertyId: string, roomNumber: string): Promise<Stay | null>;
  listArrivals(propertyId: string, date: Date): Promise<Arrival[]>;
  checkIn(stayId: string): Promise<Stay>;
  checkOut(stayId: string): Promise<Stay>;
  extendStay(stayId: string, newCheckout: Date): Promise<Stay>;
  postCharge(stayId: string, line: FolioLine): Promise<PostResult>;
}
```

Implementations today: `ManualAdapter` (front desk does it in your panel) and
later `OperaAdapter`, `CloudbedsAdapter`, `EzeeAdapter`.

A v2 booking module is simply `InternalPmsAdapter` — an implementation backed by
your own tables instead of someone else's API. **Nothing above the interface
changes.** The guest app, the KDS, the housekeeping board, the folio, and the
concierge do not learn that bookings now exist.

That is what makes this a v2 feature rather than a v2 rewrite. Guard the
interface more carefully than the schema.

### C. Reserve the names

Do not use `bookings`, `booking_rooms`, `rate_plans`, `inventory_days`,
`rate_calendar`, `cancellation_policies`, `promotions`, or `add_on_products` for
anything else. Not as a table, not as a module directory, not as a TypeScript
type. Renaming later is trivial in isolation and miserable across a codebase.

### D. Never put a price on `rooms`

Prices belong to a rate plan for a room type on a date. The moment somebody adds
`rooms.nightly_rate` "just for the admin display", the model has silently
committed to per-room pricing and every rate feature fights it afterwards.

---

## What v2 would add

Nothing below is required now. This is the shopping list so you can quote it.

**11 tables, all additive:**
`rate_plans` · `rate_calendar` · `inventory_days` · `inventory_blocks` ·
`cancellation_policies` · `bookings` · `booking_rooms` · `booking_room_nights` ·
`booking_add_ons` · `add_on_products` · `promotions` · `booking_modifications`

**Modifications to existing tables — all online, all free:**

| Change | Type | Cost |
|---|---|---|
| `ALTER TYPE stay_source ADD VALUE 'OWN_BOOKING'` | enum value | free |
| `ALTER TYPE folio_source ADD VALUE 'ROOM_NIGHT'`, `'BOOKING_DEPOSIT'` | enum value | free |
| `ALTER TYPE verification_method ADD VALUE 'BOOKING_CONFIRMATION'` | enum value | free |
| `payments.booking_id uuid NULL` | nullable column | metadata only |
| `guests.password_hash` — already present, unused | — | zero |
| `room_types.total_rooms` — already present | — | zero |
| Add booking tables to the RLS policy loop | migration | minutes |

**The genuinely new work, and where the time actually goes:**

| Piece | Estimate | Note |
|---|---|---|
| Rate plans + rate calendar admin | 3 wks | the revenue manager's daily screen |
| Availability search engine | 2 wks | correctness-critical; overselling is unforgivable |
| Booking flow, payment, cancellation policy | 3 wks | |
| Admin: tape chart, modify, cancel, refund | 3 wks | the tape chart alone is a fortnight |
| Room assignment + check-in wiring to `Stay` | 1 wk | small, because of the seams above |
| Channel manager integration (integrate, don't build) | 2 wks | never build one |

Roughly **14 weeks**. About one of those weeks is schema. The other thirteen are
the product, which is exactly why deferring the tables costs you nothing and
deferring the two structural decisions above would cost you real money.

---

## The one thing to re-read before starting v2

The hard problem in booking is not the schema, it is **concurrent inventory
under contention**. Two guests booking the last Deluxe room in the same second
must not both succeed.

`inventory_days.sold` is the contended column. Take a row lock
(`SELECT ... FOR UPDATE`) on every affected date inside the booking transaction,
in a deterministic date order to avoid deadlocks. Never read-modify-write.
Never trust an availability check performed outside the transaction that writes.

Write that test first, before any UI.
