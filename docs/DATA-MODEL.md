# Data model — hotel guest services platform

Postgres + Drizzle. Multi-tenant from day one. 51 tables: 48 across 10 domain
modules, plus 3 cross-cutting ones in `core.ts` (D-019). The full list and the
reasoning for the tables this document does not name is in `SCHEMA-PROPOSAL.md`.

---

## 1. Tenancy

```
Tenant  (the customer account — a hotel group, the billing relationship)
  └── Property  (one physical hotel — the scope every real query filters on)
        ├── Floor ──── Room ──── RoomQrCode
        ├── Outlet ─── MenuCategory ─── MenuItem
        ├── RequestType
        ├── Poi
        └── Stay  ◄── the central aggregate
```

**Every tenant-scoped table carries `tenant_id`.** Most also carry `property_id`,
because that is what queries actually filter on and it avoids a join on every
read path.

**Isolation is enforced by Postgres, not by discipline.** See
`migrations/0001_rls.sql`. Each request opens a transaction and sets:

```sql
SET LOCAL app.tenant_id   = '...';
SET LOCAL app.property_id = '...';  -- optional, narrows staff sessions
```

Wrap this once:

```ts
export async function withTenant<T>(
  ctx: { tenantId: string; propertyId?: string },
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true)`);
    if (ctx.propertyId) {
      await tx.execute(sql`SELECT set_config('app.property_id', ${ctx.propertyId}, true)`);
    }
    return fn(tx);
  });
}
```

Two gotchas that will bite you:

- **`SET LOCAL` is transaction-scoped.** Always `set_config(..., true)` inside
  an explicit transaction, never a bare `SET`. There is no PgBouncer (D-022),
  but node-postgres reuses connections across requests, so a session-scoped
  setting still leaks from one guest's request into the next one that picks up
  that connection.
- **After the transaction commits the GUC reverts to the EMPTY STRING, not to
  unset.** `''::uuid` raises, so every policy wraps it in
  `nullif(current_setting('app.tenant_id', true), '')` — otherwise a query
  outside `withTenant()` fails with a cast error instead of returning nothing.
  See D-020.
- **Table owners and superusers bypass RLS silently.** The app connects as
  `app_user`, which owns nothing and lacks `BYPASSRLS`. Migrations run as a
  different role. If you skip this, RLS is decorative.

Why not schema-per-tenant or database-per-tenant? Both make migrations across
200 hotels a scheduled outage, and hotel data volumes are small. Shared schema +
RLS is right until a single tenant needs data residency, at which point you run
a separate region deployment, not a separate schema.

---

## 2. Stay is the aggregate root

Everything guest-facing hangs off `Stay`, never off `Room`. This is the single
most important modelling decision in the product.

Rooms are reused. If orders were keyed on `room_id`, the guest who checks into
402 on Tuesday would see the previous occupant's order history, dietary notes
and folio. Keying on `stay_id` makes that structurally impossible.

`stays` carries a **partial unique index**:

```sql
UNIQUE (room_id) WHERE status = 'CHECKED_IN'
```

At most one active stay per room, enforced by the database. A stale
`guest_session` pointing at a checked-out stay resolves to nothing.

**Checking out is four writes in one transaction** (`checkOutStay()`, D-035):
the stay becomes `CHECKED_OUT` and the room frees immediately, because the
partial unique index only counts `CHECKED_IN`; every session on the stay is
revoked (#10); an `APPROVED` checkout request becomes `COMPLETED` and a
`REQUESTED` one is cancelled; and the event records the folio balance at the
moment the guest left. An unpaid balance does not block it — settlement is not
built, so the desk takes the money elsewhere and the number stays in the log.

---

### Changing when a guest leaves (D-033)

`checkout_fee_tiers` is what a property sells at the end of a stay, and a tier is
an HOUR — the new checkout time — not a duration. "Three extra hours" is derived
from the stay's own `scheduled_checkout_at`, so one row reads correctly for a
guest due out at 11am and for one due out at 1pm; only the editorial line is
stored.

An extra NIGHT is deliberately absent: pricing one needs a rate plan for a room
type on a date, which #11 forbids shortcutting and #12 reserves the names for.
`extendStay()` is on the `PmsAdapter` (EXTENSION-POINTS §B) for the same reason.

`checkout_requests` is the guest's ask and the desk's answer:

```
REQUESTED → APPROVED → COMPLETED
          ↘ DECLINED
          ↘ CANCELLED   (the guest, before the desk looks)
```

- **One open request per stay**, enforced by a partial unique index on
  `stay_id WHERE status = 'REQUESTED'` (migration 0005) — the same shape as
  D-007's one-CHECKED_IN-stay-per-room. A double tap is a conflict the insert
  absorbs (#8), and it holds however the second row arrives.
- **The fee is snapshot at request and posted at approval**, which is the reverse
  of every other charge path here (D-027, D-032) and is why this one needs no
  reversal: nothing is charged for a request that is declined, cancelled or still
  waiting. `fee_minor` is what the guest agreed to and `overridden_fee_minor`
  what the desk charged; both are kept, and a waiver is an override of zero.
- **Approving is three writes in one transaction** — `scheduled_checkout_at`
  moves, the `CHECKOUT_FEE` folio line posts, and every live guest session on the
  stay has its `expires_at` recomputed. A session expires at
  `scheduled_checkout_at + grace` fixed at mint time, so without the third the
  guest pays for the room until 6pm and the app in it stops at 1pm.
- **APPROVED does not go back.** Un-approving would have to unwind all three;
  that is a credit and a second decision, not a transition.

---

## 3. Guest identity

The QR sticker is public. `room_qr_codes.public_code` grants **room context
only** — which property and room the scan came from, nothing more.

A bare scan mints a session at `access_policies.base_tier` (default `REQUEST`)
with **no verification screen**. Verification is triggered by *action*, not by
entry. See D-012 and CLAUDE.md #9 — read D-012 before writing any of this.

```
scan /r/{publicCode}
  → resolve property + room + active CHECKED_IN stay
  → reject if the QR is revoked or the version does not match
  → issue guest_sessions row immediately, at access_policies.base_tier
      · token: random 32 bytes, httpOnly SameSite=Lax cookie
      · stored: SHA-256 of the token only
      · bound to: stay_id (not room_id)
      · isAnonymous: true
      · expires: scheduled_checkout_at + grace
  → guest browses menus, prices, POIs, and raises free requests. No prompt.

first action requiring a higher tier
  (default: access_policies.escalation_trigger = first charge to the room)
  → requireTier(session, 'CHARGE') fails
  → escalate — it does NOT 403
  → verification challenge (PHONE_LAST4 or OTP_SMS)
      · rate-limited per ROOM, across challenges: `max_attempts_per_room`
        WRONG answers inside `lockout_minutes`. A correct answer is evidence of
        legitimacy and is not counted (D-034).
  → on success, raise the tier on the EXISTING session to FULL; record in
    access_escalations. Abandonment is recorded too.

  → alternatively front desk vouches (staff_vouches) and the guest sees nothing.

checkout revokes every session for that stay
```

The reason verification exists at all is **fraud, not identity**. A QR sticker is
photographable from a corridor or a Google review photo. If a scan alone can post
₹4,000 to room 214, the hotel eats it. Browsing costs the hotel nothing, so
browsing is never gated.

`room_qr_codes.version` means reprinting a sticker invalidates the old one.
`guest_sessions.scanned_qr_code_id` lets you spot a code photographed off-site
and used from an IP that never touched hotel wifi.

`verification_challenges` is rate-limited per room and per phone. Without that,
last-4-digits verification is a five-attempt brute force.

Every knob above — `base_tier`, `escalation_trigger`, permitted methods — is
per-property in `access_policies`.

---

### Which tier a proof buys (D-031)

| Proof | Tier | Reaches |
|---|---|---|
| a bare scan | `REQUEST` | menus, prices, POIs, free requests, calling for service |
| a staff vouch | `CHARGE` | plus anything that posts money to the room |
| the guest answering the prompt | `FULL` | plus the folio, checkout and stay details |

The gap between `CHARGE` and `FULL` is about WHO vouched, not how much money is
at stake: someone else asserting a guest's identity is enough to let a charge
through and not enough to hand over their bill. A desk that means to do both
passes `grantedTier: 'FULL'`.

The prompt is asked ONCE. A guest who verified to send dinner up reaches the
folio with nothing more asked, which is the whole of D-012 in one sentence.

---

## 4. Snapshot everything transactional

Catalog rows change. Transactional rows must not.

| Table | Snapshotted fields | Live FK kept for |
|---|---|---|
| `order_items` | `name_snapshot`, `unit_price_minor`, `image_url_snapshot` | analytics only, `ON DELETE SET NULL` |
| `order_item_modifiers` | `name_snapshot`, `price_delta_minor` | analytics only |
| `service_request_items` | `label_snapshot`, `unit_price_minor` | analytics only |
| `orders` | `dietary_flags` copied from guest preferences | — |

A dish renamed or repriced next month must not silently rewrite last month's
receipts. Catalog tables are archived (`archived_at`), never hard-deleted.

---

## 5. Money

Integer minor units (`*_minor`), plus a `currency` column on every row that
holds an amount. No floats, no numeric-as-string, no implicit currency.

`folios` keeps materialised `charges_minor` / `payments_minor` /
`balance_minor`, recomputed by an `AFTER` trigger on `folio_lines` so the
totals cannot drift from the lines. `folio_lines` is append-only in practice:
corrections are negative `ADJUSTMENT` rows, never edits.

**Every charge path posts at placement and reverses at its terminal states.**
`placeOrder()` and `raiseServiceRequest()` both post the line when the guest
commits, so "charged to room 214" is true the moment they are told it; REJECTED
and CANCELLED both post a netted negative ADJUSTMENT in the same transaction as
the status change (D-027, D-032). Nothing enforces the pair — a new charge path
can post and forget to reverse, which is exactly what the requests path did for
four sessions.

**`postFolioLine()` cannot post a PAYMENT.** Its `source` union deliberately
excludes it: a payment also needs a `payments` row, and posting one through the
generic door would leave the folio and the ledger disagreeing. The recompute
trigger splits on the same line (`source <> 'PAYMENT'` into charges, `= 'PAYMENT'`
into payments), and so does the guest's statement.

**The guest reads it at `/r/[qrCode]/stay`**, behind the FULL tier (D-031).
`buildGuestStatement()` turns the folio into a bill: PAYMENT rows are summed
rather than listed as charges, credits stay next to the charges they cancel, and
the total is recomputed from the lines drawn so the number under a list always
equals the list.

---

## 6. State machines

```
Order
  DRAFT → PLACED → ACCEPTED → PREPARING → READY → OUT_FOR_DELIVERY → DELIVERED → CLOSED
                 ↘ REJECTED        ↘ CANCELLED                              ↘ DISPUTED

ServiceRequest
  OPEN → ASSIGNED → IN_PROGRESS → COMPLETED → VERIFIED
       ↘ REJECTED       ↘ CANCELLED
  (ESCALATED is not a status — it is escalated_at + escalation_level, so a
   request can be both IN_PROGRESS and breached)

CheckoutRequest
  REQUESTED → APPROVED → COMPLETED
            ↘ DECLINED
            ↘ CANCELLED
  (approval moves the stay, posts the fee and extends every live session in ONE
   transaction — §2. APPROVED does not go back: un-approving would have to
   unwind all three.)
```

Every transition writes an `event_log` row in the same transaction as the
status update. `event_log` has `UPDATE` and `DELETE` revoked from `app_user`.
That one append-only table gives you the audit trail, SLA analytics, and the
evidence when a guest says nobody came — without three separate systems.

Each aggregate carries dedicated lifecycle timestamps (`accepted_at`,
`ready_at`, `delivered_at`) alongside the event log. Redundant on purpose:
the timestamps make dashboard queries cheap, the log makes them provable.

---

## 7. Request routing

`request_types` is the property-configurable catalog behind both "order
amenities" and "call the service boy" — one generic guest UI, ops team
self-serve. Each type declares `sla_minutes` and `route_to_role_key`.

Assignment is the intersection of three things:

```
staff with role = request_type.route_to_role_key
  ∩ on shift now (shifts.status = 'ON_DUTY')
  ∩ shift_zones covers service_requests.floor_id
```

Ranked by open request count. A BullMQ worker sweeps for
`sla_target_at < now() AND status NOT IN ('COMPLETED','VERIFIED')`, bumps
`escalation_level`, and notifies the duty manager.

*(That worker is in-process rather than BullMQ — see D-028. Nothing else here
changed.)*

### The catalog is edited from `/admin/requests` (D-030)

"Ops team self-serve" is a screen now, not an aspiration: `sla_minutes`,
`price_minor`, `route_to_role_key`, the quantity and note and photo rules, and
`is_active` are all editable there. Four rules the screen enforces and the
service layer refuses regardless of what is posted:

| Rule | Why |
|---|---|
| `key` is minted once from the name and never changes | Code finds `CALL_SERVICE` by it. A key that moved when somebody fixed a typo would break the one-tap screen with no error anywhere. |
| `is_chargeable` is derived from `price_minor > 0`, never set | The guest's amenities card prints "Free" or the amount from the flag, and the verification prompt is decided by the request TOTAL. Let them disagree and a screen says Free above a request that charges the room — #9 broken by a checkbox. |
| `CALL_SERVICE` may not carry a price | `raiseServiceRequest()` demands the CHARGE tier as soon as a request totals more than zero, so a price on the one tap is a verification prompt in front of "someone comes up". CLAUDE.md #9 in one row. |
| `route_to_role_key` must name a role that exists at the property | Routing matches it against the roles staff hold. A typo produces a `NOBODY_WITH_ROLE` event on every request of that type for ever — the router working exactly as designed, and nobody coming. |

`max_quantity` collapses to 1 whenever `allows_quantity` is false, so turning the
stepper back on later cannot inherit an abandoned number.

Off and archived are different states and both are needed. Off is a season: the
type leaves the guest's list, the row stays on the admin screen so it can be
turned back on, and open requests carry on. Archived is for good, and is refused
while any request of that type is still open.

---

## 8. Reliability plumbing

- **`idempotency_keys`** — order placement, payment capture, PMS posting.
  A guest double-tapping "Place order" on flaky hotel wifi is the most common
  duplicate-write source in this product. Scope + key unique per tenant; the
  stored response is replayed on retry.
- **`integration_outbox`** — the PMS adapter drains this. A hotel's Opera
  instance being down must never fail a guest's order. Write the charge to the
  folio, queue the PMS post, retry with backoff.
- **`notifications`** — every outbound alert as a row, so a missed kitchen
  alert is diagnosable. Treat Web Push as best-effort (iOS Safari is not
  reliable enough to be the primary channel for a kitchen ticket); the KDS
  is an always-on screen with an audio alert and an unacknowledged count.

  **`IN_APP` is delivered (D-029); `PUSH`, `WHATSAPP` and `EMAIL` are not.**
  What the columns mean for the delivered channel:

  | Column | Means |
  |---|---|
  | `status = PENDING` | written, and no screen belonging to the recipient has read it |
  | `status = SENT`, `sent_at` | handed to a screen — `deliverInApp()` set it during that screen's own read |
  | `attempts` | how many times a screen picked the row up |
  | `acknowledged_at` | the recipient said they had seen it. Never a delete — the row is the audit record |

  A row still `PENDING` an hour after it was queued is therefore a fact worth
  having: nobody the alert names has opened a screen since. `template` and
  `payload` stay unrendered on the row; `renderNotification()` turns them into a
  sentence at read time, so changing the wording does not rewrite what past
  alerts said they said.

---

## 9. Index strategy

Every hot query is property-scoped, so composite indexes lead with
`property_id` or `outlet_id`:

| Query | Index |
|---|---|
| KDS open tickets | `orders (outlet_id, status, placed_at)` |
| Housekeeping board | `service_requests (property_id, status, sla_target_at)` |
| Runner's queue | `service_requests (assigned_staff_id, status)` |
| Guest order history | `orders (stay_id)` |
| Menu render | `menu_items (category_id, sort_order)`, `menu_items (outlet_id, is_available)` |
| PMS sync sweep | `folio_lines (property_id, pms_posted_at)` |
| Audit trail | `event_log (entity_type, entity_id, occurred_at)` |

`event_log` is the only table with real growth. Partition it by month once it
passes a few million rows; nothing else needs partitioning at hotel scale.

---

## 10. Seeding a new property

Onboarding a hotel should be one transaction:

1. `properties` row with timezone, currency, branding
2. `roles` — seed the 8 system roles (`is_system = true`)
3. `floors` + `rooms` from a CSV upload
4. `room_qr_codes` — one per room, version 1, then generate the print sheet
5. `outlets` — at minimum IN_ROOM_DINING, with `outlet_hours`
6. `request_types` — seed ~20 standard ones, let the property edit
7. First `staff_users` invite with PROPERTY_ADMIN

Write this as a single `provisionProperty()` service function from the start.
It is also your integration-test fixture and your demo-data generator.
