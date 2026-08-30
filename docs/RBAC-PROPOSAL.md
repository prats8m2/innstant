# S5 · Permission model, for review

**Status: proposed. Nothing committed.** S5 requires the per-role permission
list be agreed before it is seeded, because these rows become `is_system = true`
and every later authorization decision inherits them.

Permissions are `resource:action` strings, matching
`authorize(session, propertyId, 'resource:action')`.

---

## Design rules

**1. Read is separated from write, and write is separated from money.**
Three tiers, because the blast radius differs by an order of magnitude at each
step. `folio:read` is a support question; `payment:refund` is cash leaving.

**2. Verbs are domain verbs, not CRUD.** `order:advance` rather than
`order:update` — the KDS bumps a ticket through a state machine, it does not
edit an order. A CRUD-shaped permission would grant far more than the screen
actually does.

**3. Anything fraud-adjacent is its own permission**, even when it looks small.
`guest:vouch` escalates a guest session with zero guest-side interaction
(D-012) — it is the deliberate bypass of the one anti-fraud control in the
product, so it must not ride along inside `guest:update`.

**4. 403 at your property, 404 at someone else's.** A FRONT_DESK user hitting
an admin action at their own property gets `403` — they exist, they lack the
permission. The same user touching *anything* at another property gets `404`,
not `403`, because `403` would confirm that the resource exists. That is a
tenancy leak of exactly one bit, and one bit is enough to enumerate.

---

## The permissions

### Property & configuration
| Permission | Grants |
|---|---|
| `property:read` | see property settings |
| `property:update` | name, timezone, hours |
| `property:branding` | the theme editor (D-016; WCAG AA validated at save) |
| `property:access_policy` | **the D-012 knobs** — `base_tier`, `escalation_trigger`. Changing these changes who can charge to a room without verifying. |

### Staff & roles
| Permission | Grants |
|---|---|
| `staff:read` · `staff:invite` · `staff:update` · `staff:deactivate` | |
| `role:read` · `role:assign` | assign an existing role to a person |
| `role:manage` | create custom roles, edit permission sets |

### Rooms & QR
| Permission | Grants |
|---|---|
| `room:read` · `room:manage` | rooms, floors, room types |
| `qr:read` · `qr:regenerate` | reprinting bumps `version` and **invalidates the sticker on the nightstand** |

### Stays & guests
| Permission | Grants |
|---|---|
| `stay:read` · `stay:check_in` · `stay:check_out` · `stay:update` | |
| `guest:read` · `guest:update` | VIP flag, staff notes, charging block |
| `guest:vouch` | escalate a guest session from the admin panel — see rule 3 |

### Catalog
| Permission | Grants |
|---|---|
| `catalog:read` | |
| `catalog:manage` | outlets, categories, items, modifiers, collections |
| `catalog:pricing` | **change prices** — deliberately not part of `manage` |
| `catalog:availability` | the mid-service "86 the sole" toggle from the KDS |

### Orders
| Permission | Grants |
|---|---|
| `order:read` · `order:accept` · `order:reject` | |
| `order:advance` | bump through PREPARING → READY → OUT_FOR_DELIVERY → DELIVERED |
| `order:cancel` | cancel an already-accepted order |
| `order:dispute` | open a dispute against a delivered order |

### Service requests
| Permission | Grants |
|---|---|
| `request:read` · `request:advance` | start, complete |
| `request:assign` | manual override of auto-routing |
| `request:verify` | supervisor confirmation that it was actually done |
| `request:cancel` | |
| `request_type:manage` | the catalog behind amenities: SLA, price, routing role |

### Money
| Permission | Grants |
|---|---|
| `folio:read` · `folio:post_charge` | |
| `folio:adjust` | write a negative ADJUSTMENT line — the correction path |
| `folio:settle` | |
| `payment:read` · `payment:capture` · `payment:refund` | |
| `checkout_request:approve` | late checkout, extend, early checkout |
| `checkout_request:override_fee` | waive or alter the tiered fee (P3 gives this to front desk) |

### Concierge · Shifts · Reporting
| Permission | Grants |
|---|---|
| `poi:read` · `poi:manage` · `itinerary:manage` | |
| `shift:read` · `shift:manage` | rosters and floor zones |
| `shift:clock` | clock **yourself** in and out |
| `analytics:read` | |
| `audit:read` | the `event_log` |

---

## The 8 system roles

### `PROPERTY_ADMIN`
Everything above, at properties they are assigned to. The only role with
`role:manage`, `payment:refund`, `folio:adjust`, `property:access_policy`.

### `FRONT_DESK`
`property:read` · `room:read` · `qr:read` · `qr:regenerate` ·
`stay:*` (read, check_in, check_out, update) · `guest:read` · `guest:update` ·
`guest:vouch` · `folio:read` · `folio:post_charge` · `folio:settle` ·
`payment:read` · `payment:capture` · `checkout_request:approve` ·
`checkout_request:override_fee` · `order:read` · `request:read` · `poi:read`

Not: catalog management, staff, analytics, `folio:adjust`, `payment:refund`.

### `F_AND_B_MANAGER`
`property:read` · `catalog:read` · `catalog:manage` · `catalog:pricing` ·
`catalog:availability` · `order:*` (read, accept, reject, advance, cancel,
dispute) · `analytics:read` · `shift:read`

Not: stays, guests, folio, staff.

### `KITCHEN` — the KDS, an always-on shared screen
`catalog:read` · `catalog:availability` · `order:read` · `order:accept` ·
`order:reject` · `order:advance` · `shift:clock`

Not `catalog:pricing`, not `order:cancel`. Deliberately thin: this screen is
unattended in a hot kitchen and is the most likely credential in the building
to be left logged in.

### `RUNNER`
`order:read` · `order:advance` · `request:read` · `request:advance` ·
`room:read` · `shift:clock`

### `HOUSEKEEPING`
`request:read` · `request:advance` · `request:assign` · `request:verify` ·
`room:read` · `shift:clock`

### `CONCIERGE`
`poi:read` · `poi:manage` · `itinerary:manage` · `guest:read` ·
`request:read` · `request:advance` · `shift:clock`

### `READ_ONLY`
Every `:read` permission plus `analytics:read` and `audit:read`. No writes.
For an owner, an accountant, or a group-level manager.

---

# Four things I want decided, not assumed

### 1. Does `READ_ONLY` see guest PII?
As proposed it gets `guest:read` — names, phone numbers, notes, dietary flags.
For a hotel owner that is probably right. For an external accountant it is
more than they need, and it is the role most likely to be handed out casually.

**Recommend:** keep `guest:read`, and revisit if a customer asks for a
finance-only variant. Splitting now adds a ninth role for a hypothetical.

### 2. Should `HOUSEKEEPING` have `request:assign` and `request:verify`?
The 8 roles do not distinguish a housekeeper from a housekeeping supervisor.
Auto-routing (§7) assigns work without anyone touching it, so `request:assign`
is only the manual override — but a floor lead genuinely needs it when someone
calls in sick.

**Recommend:** grant both, and split into a `HOUSEKEEPING_LEAD` role only when
a real property asks. Withholding them means every reassignment escalates to
the GM, which is the friction that gets a product abandoned.

### 3. Can `FRONT_DESK` override a checkout fee without a second pair of eyes?
P3 says "Front desk approve, decline, override fee", so this follows the plan.
It is also a discount authority — ₹5,000 waived, per stay, at will.

**Recommend:** grant it as planned, but every override writes an `event_log`
row with the actor and the original fee (#7 already requires this). Control by
audit rather than by approval workflow; a second-approver step at the front
desk at 11am on checkout day will simply be worked around.

### 4. Is `KITCHEN` allowed to reject an order outright?
Granted as proposed, because a kitchen that cannot say "we are out of sole"
will accept and then fail silently — which is worse for the guest. But reject
is guest-visible and the KDS is a shared, always-logged-in screen.

**Recommend:** keep it, require a reason (already modelled as
`orders.rejection_reason`), and surface rejections in the F&B manager's daily
digest so a pattern is visible.

---

## What S5 will NOT include

No password reset, no invite flow — P0-TASKS says login and authorize only.
`staff:invite` is defined here because `provisionProperty()` in S6 creates the
first PROPERTY_ADMIN invite, but the flow that consumes it comes later.
