# S3a · Table list, for review

**Status: awaiting review. No columns written yet.** S3a's done condition is
that this list is agreed *before* a single column exists — so this file is the
checkpoint, not a record of something already built.

Derived from `docs/DATA-MODEL.md`, plus tables that `docs/PROJECT-PLAN.md`,
`docs/P0-TASKS.md` and `docs/EXTENSION-POINTS.md` require but DATA-MODEL never
names. Everything in the second category is marked **[inferred]** — those are
the ones that actually need your eyes.

DATA-MODEL's header says "44 tables across 9 domain modules". This list comes to
**51**, and the gap is entirely inferred join tables and P1/P4 features.
Reconciling that is decision 6 below.

---

## `identity` — tenancy, staff, RBAC

| # | Table | Source |
|---|---|---|
| 1 | `tenants` | DATA-MODEL §1 |
| 2 | `properties` | §1 · carries `timezone`, `currency`, `branding` jsonb (D-016) |
| 3 | `floors` | §1 |
| 4 | `rooms` | §1 · **no price column, ever** (#11) |
| 5 | `room_types` | EXTENSION-POINTS §1 · real table, FK from `rooms` |
| 6 | `room_qr_codes` | §3 · `public_code`, `version` |
| 7 | `staff_users` | §10 |
| 8 | `roles` | §10 · 8 system roles, `is_system` |
| 9 | `role_permissions` | **[inferred]** — see decision 1 |
| 10 | `staff_property_roles` | **[inferred]** — see decision 2 |
| 11 | `staff_sessions` | **[inferred]** — S5 needs a hashed session token at rest |

## `stay` — sealed behind `createStay()` (#4)

| # | Table | Source |
|---|---|---|
| 12 | `stays` | §2 · partial unique `(room_id) WHERE status='CHECKED_IN'`; `source` + `source_ref_id` |
| 13 | `guests` | EXTENSION-POINTS §2 · unique on `(tenant_id, phone)` — **not** property |
| 14 | `guest_property_profiles` | EXTENSION-POINTS §2 |
| 15 | `checkout_requests` | §6 state machine |

## `access` — D-012, the thing most likely to be built wrong

| # | Table | Source |
|---|---|---|
| 16 | `guest_sessions` | §3 · bound to `stay_id`, SHA-256 only, `is_anonymous`, `access_tier` |
| 17 | `access_policies` | `base_tier`, `escalation_trigger` — per property |
| 18 | `access_escalations` | attempts *and* abandonment |
| 19 | `verification_challenges` | rate-limited per room and per phone |
| 20 | `staff_vouches` | front desk escalates with zero guest interaction |

## `catalog`

| # | Table | Source |
|---|---|---|
| 21 | `outlets` | §10 |
| 22 | `outlet_hours` | §10 |
| 23 | `menu_categories` | §1 |
| 24 | `menu_items` | §1 · `archived_at`, never hard-deleted (D-008) |
| 25 | `modifier_groups` | P1 "reusable across items" |
| 26 | `modifier_options` | **[inferred]** — the options inside a group |
| 27 | `menu_item_modifier_groups` | **[inferred]** — join; "reusable" requires it |
| 28 | `collections` | P1 "editorial collections" |
| 29 | `collection_items` | **[inferred]** — join |
| 30 | `menu_item_availability_windows` | P1 "scheduled windows" |

## `ordering`

| # | Table | Source |
|---|---|---|
| 31 | `carts` | P0-TASKS · one per `(stay, outlet)` |
| 32 | `cart_items` | **[inferred]** |
| 33 | `cart_item_modifiers` | **[inferred]** |
| 34 | `orders` | §6 · `outlet_id`, `stay_id`, lifecycle timestamps, `dietary_flags` |
| 35 | `order_items` | §4 · `name_snapshot`, `unit_price_minor`, `image_url_snapshot` |
| 36 | `order_item_modifiers` | §4 · `name_snapshot`, `price_delta_minor` |

## `requests`

| # | Table | Source |
|---|---|---|
| 37 | `request_types` | §7 · `sla_minutes`, `route_to_role_key` |
| 38 | `service_requests` | §6 · `escalated_at` + `escalation_level`, not a status |
| 39 | `service_request_items` | §4 · `label_snapshot`, `unit_price_minor` |

## `housekeeping`

| # | Table | Source |
|---|---|---|
| 40 | `shifts` | §7 · `status = 'ON_DUTY'` |
| 41 | `shift_zones` | §7 · covers `floor_id` |

## `billing`

| # | Table | Source |
|---|---|---|
| 42 | `folios` | §5 · materialised totals, AFTER trigger on lines |
| 43 | `folio_lines` | §5 · append-only; corrections are negative ADJUSTMENT rows |
| 44 | `payments` | P3 · Razorpay |

## `concierge`

| # | Table | Source |
|---|---|---|
| 45 | `pois` | §1 |
| 46 | `itineraries` | P4 — **defer?** see decision 6 |
| 47 | `itinerary_stops` | P4 — **defer?** |

## `notifications`

| # | Table | Source |
|---|---|---|
| 48 | `notifications` | §8 · every outbound alert as a row |

## Cross-cutting — `src/db/schema/core.ts`, owned by no module

| # | Table | Source |
|---|---|---|
| 49 | `event_log` | §6 · UPDATE/DELETE revoked from `app_user` |
| 50 | `idempotency_keys` | §8 |
| 51 | `integration_outbox` | §8 |

---

# Decisions I need before writing columns

### 1. How are permissions stored?
S5 says `authorize(session, propertyId, 'resource:action')` and asks me to
propose a permission list per role. DATA-MODEL never says where permissions
live. Options: a `role_permissions` row per grant (queryable, auditable,
editable per property later) or a `text[]` on `roles` (simpler, one fewer join).

**Recommend: `role_permissions` table.** Custom per-property roles beyond the 8
system ones are a near-certain P2/P3 ask, and an array makes "which roles can
do X" unanswerable without scanning.

### 2. How does a staff user get a role at a property?
S5: "the session carries tenantId and the set of propertyIds the user has roles
at" — plural, so this is many-to-many and needs a join table. DATA-MODEL doesn't
name one. Proposing `staff_property_roles (staff_user_id, property_id, role_id)`.
This is what makes a group GM real.

### 3. Who owns `event_log`?
This one genuinely conflicts with an invariant. CLAUDE.md says a module's tables
are importable only from that module — but **every** module must write
`event_log` in its own transaction (#7). Making it module-private to any one
module breaks #7 or breaks D-001.

**Proposing:** `event_log`, `idempotency_keys` and `integration_outbox` live in
`src/db/schema/core.ts`, outside every module, with `src/db/events.ts` exposing
`recordEvent(tx, …)` that takes the caller's transaction. The boundary lint rule
already permits `src/db/**` to import schema, so this needs no exception —
modules call the function, never the table. Confirm and I'll append it to
DECISIONS.md as D-019.

### 4. Does `carts` snapshot prices?
#6 says snapshot every transactional line. A cart is pre-transactional — a dish
repriced while it sits in a cart arguably *should* update. Proposing: carts hold
live FKs only, snapshots happen at order placement. This means the guest can see
a total change between cart and confirmation, which is correct but needs a UI
affordance in P1.

### 5. Where does the access tier live on a session?
`guest_sessions.access_tier` as an enum, escalated in place (D-012 says the tier
is raised on the existing session, not a new one). Confirming this rather than
issuing a second session on escalation.

### 6. Reconciling 51 vs DATA-MODEL's stated 44
The extra seven are: `role_permissions`, `staff_property_roles`,
`staff_sessions`, `modifier_options`, `menu_item_modifier_groups`,
`collection_items`, `cart_item_modifiers` — plus `itineraries` /
`itinerary_stops` for P4.

**Recommend: build all of P0–P3's tables now (1–45, 48–51) and defer the two
itinerary tables to P4.** Adding a table later is free (EXTENSION-POINTS opening
paragraph); changing a unique constraint on a populated one is not. None of the
deferred pair carries a constraint anything else depends on.

I'd then update DATA-MODEL's "44 tables" line to match whatever we agree, since
that number is currently wrong either way.

### 7. Confirm no reserved name is used
Checked against #12 — none of `bookings`, `booking_rooms`, `rate_plans`,
`rate_calendar`, `inventory_days`, `cancellation_policies`, `promotions`,
`add_on_products` appears above. `room_types` is deliberately present and is
*not* reserved (EXTENSION-POINTS §1 requires it now).
