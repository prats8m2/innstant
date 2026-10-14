# Customer accounts, without breaking the anonymous scan

A proposal, not a decision. Written because the two designs look like they
collide and the collision is in a different place from where it appears.

---

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

## The property that falls out for free

`guests` is unique on `(tenant_id, phone)` — EXTENSION-POINTS §2, which made it
tenant-scoped on purpose. Anonymous checkout already calls
`upsertGuestByPhone()`.

So an order placed anonymously on Tuesday is **already attached** to the guest
row that a Thursday sign-in resolves to. History works retroactively with no
backfill and no merge script. That is §2 paying for itself, four sessions after
it was written down.

---

## The one genuinely contested call

**Should a customer who OTPs into a phone number see the room-service orders a
hotel guest placed with that same number?**

*Yes* is defensible: OTP proves control of the number, the hotel recorded it as
that guest's, so it is the same person.

*No* is safer, and here is the concrete leak. Hotel phone numbers are typed by
a front desk and arrive from a PMS; they are stale, mistyped and recycled. If
one belongs to somebody else today, that person signs in and sees room-service
orders — including `destination_label`, which reads **"Room 214"**. A wrong
digit leaks a room number and what its occupant ate.

**Recommendation: account history shows VISIT orders only** — the orders placed
through this app and the property links. Room-service orders stay visible
inside the stay context, where D-012 already governs who may see them. One
predicate (`visit_id IS NOT NULL`) and reversible later if the trust model
changes.

Add `guests.phone_verified_at` regardless, so an OTP-verified number is
distinguishable from a front-desk-typed one.

---

## What this means concretely

### Schema — migration 0009

| | |
|---|---|
| `guests.phone_verified_at` | nullable timestamptz |
| `orders.guest_id` | nullable FK → guests, + index `(guest_id, placed_at DESC)` |
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

### App

`mobile/lib/session.tsx` currently holds exactly one `ApiSession`, always a
visit. It becomes two independent slots — context and customer — each restored
and refreshed on its own. Account screens, cart prefill from the profile,
history that is account-wide when signed in and visit-scoped when not, saying
which.

---

## Tranches

**T1 — this.** Schema, `modules/customer`, the auth and account endpoints, the
app's account screens and cart prefill. Delivers everything in the request
except the room surface.

**T2 — the room/stay surface in the app.** ~8 endpoints (amenities, service
requests, checkout, folio, concierge) plus D-012's escalation redesigned for
JSON, which the web currently does inline in a server action's return value.
That last part is its own design problem and should not be rushed inside T1.

The app shows room features as "scan the code in your room" until T2 lands,
which is honest and is also what a guest would do anyway.

---

## What needs deciding before implementation

1. **Account history: visit orders only, or stay orders too?** Recommendation
   above is visit-only, for the "Room 214" leak.
2. **Two headers, or something else?** Recommendation is two, because it keeps
   the shipped APK working.
3. **Is T2 in or out of this build?** It roughly doubles the work.
