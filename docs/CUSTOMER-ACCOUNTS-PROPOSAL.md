# Customer accounts, without breaking the anonymous scan

**DECIDED, 14 October 2026.** The three questions this document closed with
have been answered. The answers are folded in: the "contested call" section is
replaced by what was chosen, and one claim it made has been retracted.

Written because the two designs look like they collide and the collision is in
a different place from where it appears.

## The collision is not "anonymous versus logged in"

Those two coexist trivially — one customer has an account, another does not,
and the menu renders the same for both.

The actual collision is that **one credential has been doing two jobs**, and
the second job only became visible when accounts arrived:

| | question it answers | lifetime | governed by |
|---|---|---|---|
| **Context** | *where* are you ordering from? | a visit: 6 hours. a stay: until checkout + grace | D-012, #10 |
| **Identity** | *who* are you? | weeks. until you sign out | the account |

`guest_sessions` answers the first. An account answers the second. They are
orthogonal, and trying to fold identity into `guest_sessions` breaks it three
separate ways:

1. **Lifetime.** A table tent's session must die in six hours — that is what
   stops the next diner inheriting a cart. An account must survive for weeks.
   One row cannot have both expiries.
2. **The CHECK.** `num_nonnulls(stay_id, visit_id) = 1` says a session is in
   exactly one context. Identity is in *none* of them.
3. **Order history has no context at all.** Open the app, signed in, having
   scanned nothing — you should still see last week's orders. Today that is
   impossible, because every endpoint requires a context session. This is the
   state that proves identity cannot live inside a context.

### The four states a request can be in

| context | identity | what it is |
|:---:|:---:|---|
| ✗ | ✗ | nothing to serve — the API needs a context to know *which menu* |
| ✓ | ✗ | **today.** Anonymous ordering. #9 holds, unchanged. |
| ✓ | ✓ | a signed-in customer at a table, or in a room |
| ✗ | ✓ | **new.** Checking order history before scanning anything |

Row 2 must keep working exactly as it does. Row 4 is the new requirement. Rows
2 and 4 cannot both be served by one credential.

---

## The resolution: two credentials, one order record

### 1. Context session — `guest_sessions`, unchanged

Keeps its CHECK, its tiers, its expiry, its revocation. D-012 and #10 are
untouched. This is deliberate: it is the thing that has been thought about
hardest and it is not what needs to change.

### 2. Customer session — a new `customer_sessions` table

Bound to `guests.id`. Its own expiry, its own revocation, its own token. Token
stored as SHA-256 only, same rule as every other session in this product (#10's
second sentence).

### 3. `orders.guest_id` — nullable, stamped at placement

Today an order has **no** path to a person except a two-step join through
`stays.guest_id` or `visits.guest_id` — two paths, a COALESCE, and no index
that can serve "this customer's orders, newest first". A nullable
`orders.guest_id` with `(guest_id, placed_at DESC)` is the same reasoning as
`destination_label` (D-079): denormalise the thing the read path actually asks
for.

It is stamped from whichever source knows the answer at placement — the visit's
`guest_id` after `setVisitDetails()`, or the stay's.

---

## The rule that keeps this safe

> **A customer session grants ZERO access to any context.**

Signing in never raises an access tier. It cannot: being a known customer is
not evidence that you are the person in room 214 — that is exactly what D-012's
phone-last-4 prompt is for, and it stays there, scoped to that stay.

What the customer session unlocks is only what belongs to the **account**:
profile, saved addresses, order history. Nothing that belongs to a **context**.

This is the single easiest mistake to make here and the most expensive one.

---

---

## What does NOT fall out for free — a retraction

An earlier draft claimed retroactive history was free: `guests` is unique on
`(tenant_id, phone)`, anonymous checkout already calls `upsertGuestByPhone()`,
so an order placed anonymously on Tuesday would already be attached to the
guest row a Thursday sign-in resolves to.

The linkage is real. **Showing it is not safe**, and the reason is the one that
also rules out room-service orders.

Anonymous checkout takes a phone number and **does not verify it**. Nothing
stops somebody typing a stranger's number. If that order then surfaced in the
stranger's history when they signed in by OTP, they would read its
`destination_label` — which for a delivery is literally
`Delivery · 12 MG Road, 2nd floor`.

**A home address, leaked by a typo.**

So history is orders placed **while a customer session was attached**. Verified
identity, verified history. The cost is that orders placed before somebody made
an account never appear — a real loss, and the honest consequence of not
verifying a phone at anonymous checkout.

---

## The scope of an account, decided

> **Account history = orders placed while signed in, through a DIRECT link.**

Three exclusions, each for its own reason:

| excluded | why |
|---|---|
| **Room service** (`IN_ROOM`, a stay) | hotel phone numbers are typed by a front desk — stale, mistyped, recycled. `destination_label` reads "Room 214". |
| **Table orders** (a `TABLE` link) | a table order belongs to the table and the moment. Who ordered and who pays are routinely different people. |
| **Anything placed signed-out** | the phone behind it was never verified. See the retraction above. |

What remains is exactly the food-delivery relationship — which is what an
account in this app *is*. Room service and table ordering keep working for
everybody, signed in or not (#9); they simply do not accumulate into a personal
history.

### What that costs in the schema

`orders.fulfilment` cannot express the rule alone: `TAKEAWAY` is produced by
both a `COUNTER` link and an `ONLINE` one, and only the second counts. So:

- **`visits.link_kind`** — denormalised from the link at `openVisit()`, which
  already receives it. Without it the history query is a two-hop join through
  `visit_links` to ask a question the visit should answer itself.
- **`orders.guest_id`** — stamped only when a customer session was present at
  placement, giving the column an honest meaning: *placed by a verified
  account*. Analytics wanting "who sat at table 4" still have
  `visits.guest_id`, which checkout sets regardless.

History is then `WHERE guest_id = ? AND link_kind = 'ONLINE'`, served by
`orders (guest_id, placed_at DESC)`.

---

## What this means concretely

### Schema — migration 0009

| | |
|---|---|
| `guests.phone_verified_at` | nullable timestamptz |
| `orders.guest_id` | nullable FK → guests, + index `(guest_id, placed_at DESC)`. Stamped only when a customer session was present at placement. |
| `visits.link_kind` | denormalised `visit_link_kind`, nullable. `openVisit()` already receives it. |
| `customer_sessions` | tenant_id, guest_id, token_hash (unique), expires_at, revoked_at, last_seen_at, ip, user_agent |
| `otp_challenges` | tenant_id, phone, code_hash, attempts, max_attempts, locked_until, expires_at, consumed_at, + index `(tenant_id, phone, created_at)` |
| `guest_addresses` | tenant_id, guest_id, label, line, notes, is_default, archived_at |

All additive. Nothing rewrites a populated table. Each new table needs its own
RLS policy — 0001's loop runs once, at 0001, so a later table ships wide open
without one (0008 shows the shape).

**No pre-tenant lookup is needed.** OTP requests arrive carrying the *context*
token, so the tenant is already known — because the app always has a context,
having booted into its default link. That avoids a third SECURITY DEFINER
function.

`guests.password_hash` stays unused. EXTENSION-POINTS reserved it for v2
booking's guest login; OTP does not need it, and repurposing a column reserved
for something else is how a reservation stops meaning anything.

### Module — a new `modules/customer/`

Owns `customer_sessions`, `otp_challenges`, `guest_addresses`. Calls
`modules/stay` for `guests`, which already exports `upsertGuestByPhone()`.
Needs adding to the `MODULES` list in `eslint.config.mjs` so its tables are
sealed like every other module's.

Not `modules/identity` — that is **staff** auth. Not `modules/access` — that is
context sessions and D-012.

### API — the credential plumbing

```
Authorization: Bearer <context-token>     unchanged
X-Customer-Token: <customer-token>        new, optional
```

The context keeps `Authorization` specifically so **nothing already shipped
breaks**. There is an APK on a phone right now that sends it; `/v1` is
versioned because an installed client cannot be redeployed, and that promise
starts applying now rather than at the first convenient moment.

New endpoints: `POST /auth/otp/request`, `POST /auth/otp/verify`,
`GET /auth/me`, `POST /auth/logout`, `GET|PATCH /profile`,
`GET|POST|PATCH|DELETE /addresses`, and `GET /orders?scope=account`.

`GET /orders` keeps its current meaning — **this visit's** orders — so the
shipped APK is unaffected. `?scope=account` is the new, additive behaviour and
requires the customer token.

### App

`mobile/lib/session.tsx` currently holds exactly one `ApiSession`, always a
visit. It becomes two independent slots — context and customer — each restored
and refreshed on its own. Account screens, cart prefill from the profile,
history that is account-wide when signed in and visit-scoped when not, saying
which.

---

---

## Scope

**In:** schema 0009, `modules/customer`, the auth and account endpoints, the
app's account screens, cart prefill from the profile, and history.

**Out — explicitly, not deferred-and-forgotten:** the room/stay surface in the
app. The ~8 endpoints behind it (amenities, service requests, checkout, folio,
concierge) and D-012's escalation redesigned for JSON are a separate piece of
work with a real design problem inside it, and the web already serves all of it
today. A guest in a room scans the nightstand sticker and gets the web app,
which is what that flow was built for — D-080's whole argument.

The app's scan screen still reads a room QR (`extractCode` matches `/r/`), so
somebody who scans one reaches something rather than nothing. What it does with
it is a later question.

---

## The three questions, answered

1. **Account history: room-service orders too?** — **No.** Direct-link orders
   only, placed while signed in. Table orders excluded as well.
2. **Two headers?** — **Yes.** `Authorization` keeps carrying the context, so
   the APK already installed keeps working.
3. **Room/stay surface in this build?** — **No.** Out of scope.
