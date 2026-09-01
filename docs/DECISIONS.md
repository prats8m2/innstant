# Decisions

Why the codebase is shaped the way it is. Append, never rewrite. If a decision is
reversed, add a new entry that supersedes it rather than editing the old one.

Format: what was decided · why · what it costs.

---

### D-001 · Modular monolith, not microservices
One deployable, hard module boundaries, each module owning its tables.
Microservice-shaped seams without the distributed-systems tax. `ordering` can be
extracted later if the restaurant side grows its own life.
**Cost:** boundary discipline has to be enforced by lint, not by network.

### D-002 · Next.js App Router in `standalone` mode, persistent Node process
The KDS needs live push and the app needs a long-lived DB pool. Serverless can do
neither well.
**Cost:** we manage a container instead of pushing to a CDN.

### D-003 · Drizzle, not Prisma or TypeORM
Better in server components, no engine binary in the container, SQL-shaped enough
that Postgres knowledge transfers directly.

### D-004 · Multi-tenant from day one: shared schema + `tenant_id` + RLS
Retrofitting tenancy is a rewrite. Schema-per-tenant makes migrations across 200
hotels a scheduled outage; hotel data volumes don't justify it.
**Cost:** `tenant_id` on 45+ tables, and the `withTenant()` discipline.

### D-005 · Isolation enforced by Postgres RLS, not application filtering
A forgotten `WHERE tenant_id = ...` becomes a returns-nothing bug instead of a
cross-hotel leak. Requires the app to connect as `app_user` (owns nothing, no
`BYPASSRLS`) and PgBouncer in transaction pooling mode.
*Amended by D-022: the `app_user` requirement stands and is what makes this
work; the PgBouncer requirement does not. The tenant context is still set with
`set_config(..., true)` inside a transaction, which is what the policies read.*

### D-006 · `Tenant` and `Property` are separate
Tenant = customer account and billing relationship. Property = one physical
hotel. A group with six hotels is one tenant, six properties.

### D-007 · `Stay` is the aggregate root, not `Room`
Rooms are reused. Keying guest data on `room_id` would show the previous
occupant's orders, dietary notes and folio to the next guest. Enforced by a
partial unique index: one `CHECKED_IN` stay per room.

### D-008 · Snapshot prices and names on all transactional rows
Catalog changes; receipts must not. Catalog rows are archived, never deleted.

### D-009 · Money as integer minor units + explicit currency per row
No floats. Currency denormalised so historical rows survive a property switching
currency.

### D-010 · One append-only `event_log` for all state transitions
Written in the same transaction as the status change. UPDATE and DELETE revoked.
Serves as audit trail, SLA analytics source, and dispute evidence — instead of
three systems that disagree.

### D-011 · `PmsAdapter` is the boundary to reservation data
Everything outside `modules/stay/` reaches stays through this interface.
Implementations: `ManualAdapter` today, `OperaAdapter`/`CloudbedsAdapter` later.
This is also what makes a future booking module just another implementation.
**This is the most important seam in the codebase.**

### D-012 · Verification is triggered by action, not by entry — SUPERSEDES the original always-verify design
Original design required phone/OTP verification on every QR scan. Rejected: it
kills adoption, and a guest who can't see a menu without a login won't come back.

New model: a bare scan grants `access_policies.base_tier` (default `REQUEST` —
browse everything, call for service, raise free requests). One verification
prompt appears at the property's configured `escalation_trigger`, by default the
first attempt to charge to the room.

The reason verification exists at all is fraud, not identity: a QR sticker is
photographable from a corridor, a lift, or a Google review photo. If a scan alone
can post ₹4,000 to room 214, the hotel eats it. Front desk can also vouch from
the admin panel (`staff_vouches`) so the guest sees no prompt at all.
Every knob is per-property in `access_policies`.

### D-013 · Booking is NOT in scope; the seams for it are
Eleven booking tables were designed and then removed. Kept: `room_types` as a
real entity, tenant-scoped `guests` + `guest_property_profiles`, and
`stays.source` / `stays.source_ref_id`. Rule applied: keep changes that would
need data reconciliation later, drop everything purely additive.
See `EXTENSION-POINTS.md`. Estimated v2 cost ≈ 14 weeks, of which ≈1 is schema.

### D-014 · Booking is a different sale, not a bigger version of this one
A hotel running Opera will not replace it. Booking is only sellable to properties
with no PMS, roughly 10–45 keys — a different buyer, price point and sales cycle.
Guest services is the wedge because it adds almost no ongoing work for the hotel;
rate and inventory management adds someone's morning, every morning.

### D-015 · Realtime v1 is Postgres `LISTEN/NOTIFY` → SSE. No Redis, no Socket.IO.
A persistent Node process can hold both. Removes two services from the demo
stack. Revisit when a single process can no longer hold the staff connections.

### D-016 · Theming is a token swap, never a layout fork
Identical DOM across every hotel; only CSS custom properties differ, driven by
`properties.branding`. One bounded exception: a `heroStyle` token with three
permitted values. Anything else and we have 40 frontends, not a product.
Contrast (WCAG AA) is validated at save time in the admin panel.

### D-017 · Railway for hosting, not Vercel
Vercel's Hobby plan is non-commercial only and their definition covers a paid
consultant writing the code; enforcement is real and failure mode is a silent
pause. Moot anyway — D-002 needs a persistent process. Railway Hobby ($5/mo,
includes $5 credit) runs app + Postgres in one project, Singapore region.
Supabase free was rejected for the 7-day inactivity pause and zero backup
retention, which is exactly wrong for a sporadically-demoed product.

### D-018 · Demo data is seeded and resettable, never real
`pnpm demo:reset` wipes and reseeds The Kesari (34-key Udaipur haveli) with a
full menu, ten rooms, in-flight orders and a partial folio. Run before every
demo. No real guest PII in a free-tier database.

### D-019 · `event_log` and the other cross-cutting tables are exempt from the module boundary
`event_log`, `idempotency_keys` and `integration_outbox` live in
`src/db/schema/core.ts`, owned by no module and importable from anywhere.

D-001 says a module's tables are importable only from that module. #7 says every
status change writes an `event_log` row **in the same transaction**. Those
conflict for a table that every module must write. Scoping `event_log` to one
module would mean either breaking #7 or routing every write through another
module's service.

`src/db/events.ts` exposes `recordEvent(tx, …)`, which takes the caller's
transaction. Prefer it. **Cost:** the lint rule can enforce that the table is
reachable, but not that the write happens in the caller's transaction — that
part is convention, and S4's tests are what actually hold it up.

### D-020 · RLS policies compare against `nullif(current_setting(...), '')`
After a transaction using `set_config(..., true)` commits, the GUC does not
revert to unset — it reverts to the **empty string**. `''::uuid` raises 22P02,
so a policy written as `current_setting('app.tenant_id', true)::uuid` makes any
query outside `withTenant()` fail with a cast error rather than return zero
rows. `nullif` restores the documented behaviour: return nothing, never
everything, and never a 500. Verified on PostgreSQL 18.

### D-021 · Three database connections, because the pooler and `LISTEN/NOTIFY` are incompatible
> **SUPERSEDED by D-022.** There is no pooler, so there are two connections and
> the listener uses an ordinary one. Kept because the incompatibility it
> documents is real and will matter again if PgBouncer is ever reintroduced.
`DATABASE_URL` (app queries) goes through PgBouncer in transaction pooling mode.
`DATABASE_MIGRATION_URL` (migrations, owner role) and `DATABASE_LISTEN_URL`
(the realtime listener, app_user) both go **direct**, bypassing the pooler.

CLAUDE.md #3 requires transaction pooling. D-015 makes realtime Postgres
`LISTEN/NOTIFY` → SSE. These cannot share a connection: in transaction pooling
mode the server connection is returned to the pool the instant the transaction
ends, so a `LISTEN` registration is either lost or, worse, left on a connection
subsequently handed to a different client. The listener must therefore hold one
long-lived session that never goes through PgBouncer — a single connection for
the whole process, not one per request, which the persistent Node process of
D-002 makes cheap.

Migrations bypass the pooler for a simpler reason: DDL and the RLS verification
block in `0001` want one uninterrupted session.

**Cost:** three URLs to keep straight, and a pooler whose correct configuration
is infrastructure rather than code. `pnpm db:check-pooler` is the compensating
control — it proves transaction mode is actually in effect rather than assumed,
and S4's `SET LOCAL` leak test is not meaningful until it passes.

### D-022 · No PgBouncer — SUPERSEDES the pooling half of CLAUDE.md #3 and all of D-021
The app connects directly to Railway Postgres. Connection pooling is
node-postgres inside our own process (`max` 10 by default), which the
persistent Node process of D-002 makes viable — the pool is created once per
process, not per request.

**Why the reversal.** PgBouncer was carried over from a serverless-shaped
instinct that D-002 had already rejected. At the scale this product actually
runs at — one process, a handful of staff screens, a few dozen guest sessions
per property — a direct connection with a small in-process pool is sufficient,
and the pooler was costing a Railway service, a third connection string, and a
class of silent misconfiguration that had already produced two dead ends.

**What it buys, beyond simplicity.** D-021 is dissolved rather than deferred:
`LISTEN/NOTIFY` cannot survive transaction pooling, so a pooler would have
forced a separate long-lived direct connection for D-015's realtime layer.
Without PgBouncer the listener uses an ordinary connection and the whole
three-URL arrangement collapses back to two.

**What does NOT change.** `withTenant()` still uses `set_config(..., true)`
inside an explicit transaction, and a bare `SET` is still forbidden. That was
never really about PgBouncer: node-postgres reuses connections across requests
too, so a session-scoped setting leaks between guests either way. The rule
stands on its own, and keeping it means a pooler can be reintroduced later
without touching application code.

**Cost / when to revisit.** Postgres spends roughly 10MB per connection and
Railway's default `max_connections` is finite. Revisit when the app runs more
than one replica, or when idle connections become a measurable share of the
database's memory. At that point PgBouncer goes back in front of
`DATABASE_URL` only, and `DATABASE_LISTEN_URL` is reintroduced pointing
direct — the design is already shaped for it.

### D-023 · No token build pipeline — SUPERSEDES the generator half of D-016
There is no `design/tokens/tokens.json`, no `tokens.schema.json`, no
`pnpm tokens:build`, and no generated `tokens.css`. The design values from the
Kesari export live directly in `src/styles/theme.css` as CSS custom properties,
hand-maintained, documented in `design/reference/DESIGN-SPEC.md`.

**Why.** The pipeline was three sessions of scaffolding — author the JSON,
write a schema, write a generator, add a CI staleness check — before a single
screen existed. With one property and one theme, the JSON would have been a
lossy copy of a CSS file that a build step then turned back into a CSS file.
The reference export is the spec; going through an intermediate format bought
nothing and delayed every guest screen.

**What does NOT change.** D-016 stands where it matters: identical DOM across
every hotel, and only custom-property values differ. Components reference
`var(--saffron)`, never `#E9A227`. A second hotel is still a palette swap and
not a layout fork — `properties.branding` will set the same variables at
runtime, which is what `ThemeProvider` was always going to do. The generator
was the disposable half of D-016; the discipline is the half that matters.

**Cost / when to revisit.** Two things get harder. Multi-theme validation is
now manual — the schema would have caught a theme file missing a key, and
nothing does now; a runtime check in the admin panel's theme editor should
cover it when P5 arrives. And WCAG AA contrast is no longer validated at
save-time by a build step, so that check moves into the theme editor too.
Revisit if a third or fourth hotel theme lands before P5, since that is the
point where hand-maintaining parallel palettes starts to drift.

### D-024 · CI runs the integration suite against an ephemeral Postgres
GitHub Actions starts a `postgres:18` service container, creates `app_user`
with `pnpm db:bootstrap`, applies the migrations as the owner, and runs the
integration suite against that. Not against the shared Railway database.

**Why.** Three reasons, in order of how much they would have hurt.

The suite deletes rows. `tests/integration/setup.ts` suspends FK triggers and
wipes fixtures; pointing that at the database a demo is running on is a matter
of time. Two developers running it at once already conflict, since
`fileParallelism: false` only serialises one machine.

It is slow. The same 65 tests take about six seconds locally and minutes
against Singapore, and the config carries a 90s `testTimeout` and a 180s
`hookTimeout` purely to absorb that latency. A CI run should not be dominated by
round trips.

And it makes the two-role setup explicit rather than inherited. `db:bootstrap`
creates `app_user` as a plain LOGIN role and refuses to continue if it has
SUPERUSER or BYPASSRLS — so every CI run rebuilds, from nothing, the exact
property that makes CLAUDE.md #2 real. An isolation suite that quietly ran as an
owner would pass every assertion and prove nothing.

**What this required.** The hardcoded `ssl: { rejectUnauthorized: false }` in
every client became `dbSsl()`, which reads the host: local means no TLS, remote
keeps exactly the previous behaviour. A service container speaks no TLS at all.

**Cost / when to revisit.** CI now proves the schema and the policies against a
fresh database, which is the stronger claim, but no longer proves anything about
the *live* one — a drifted Railway database (a hand-applied fix, a migration run
out of order) would not be caught. `/api/health` reports migration drift for
that reason, and `pnpm status` still checks the real thing. Revisit if a
scheduled job against the live database becomes worth its flakiness.

### D-025 · The deploy image cannot reach the database as the owner
The Dockerfile ships the standalone server and its traced dependencies. It does
not contain `src/db/migrations`, `tsx`, or `DATABASE_MIGRATION_URL`. Migrations
are run deliberately — from CI or a laptop — as the owner role, against a
database the app can only ever reach as `app_user`.

**Why.** An image that can migrate is an image that holds credentials which
bypass every RLS policy in the schema (CLAUDE.md #2). Auto-migrate-on-boot also
means N replicas racing the same DDL, and a failed migration taking the app down
with it rather than leaving the previous version serving.

The cost of separating them is that a deploy can get ahead of its schema. That
is why `/api/health` compares the migrations the build expects — baked in at
build time, since standalone ships neither package.json nor the migrations
directory — against what the database has run, and names the difference.

**Why drift is `degraded` on a 200 and not a 503.** Failing the health check on
pending migrations deadlocks the ordinary order of a deploy: the new container
has to be up and passing before anything runs against it. It would also turn a
visible, nameable problem into a container that never starts. Alert on
`degraded`; do not route on it.

**Cost / when to revisit.** Someone has to remember. Revisit when the first
migration that must land in the same breath as its code does — at that point the
answer is a Railway pre-deploy command with the owner URL scoped to it, not the
app's own environment.

### D-026 · The guest's live feed is its own route, not the kitchen's with a role switch
`/api/kds/stream` authorizes a staff session with `order:read` and filters
notifications by outlet. `/api/guest/order-stream` authorizes the guest session
cookie and filters by `stay_id` **and** one order id. The two share the shape of
the SSE plumbing — `retry:`, heartbeat, `ready` after LISTEN, abort cleanup —
and duplicate about forty lines of it deliberately.

**Why.** They differ in the credential they trust, the key they filter on, and
what a mistake costs. A single handler that switches on "is this a staff session
or a guest cookie" is one inverted condition away from streaming an entire
kitchen's traffic to a guest's phone, and that class of bug does not announce
itself — the stream still works. Two routes make the blast radius of each filter
readable in one screen.

The guest route filters on `stay_id`, never `room_id` (CLAUDE.md #10): rooms are
reused, and the next occupant of 214 must not hear about tonight's dinner.
It checks no access tier — watching your own order arrive is a `REQUEST`-tier
read, and the charge already happened at the one prompt (#9, D-012).

**Cost / when to revisit.** A third stream (the runner queue, housekeeping)
makes three copies. At that point factor the *transport* into a helper and keep
the authorize-and-filter pair written out in each route, which is the half worth
reading.

### D-027 · A rejection reverses its own folio line, in the same transaction
`placeOrder()` posts the folio line at placement, so "Charged to room 214" is
true the moment the guest presses Send. `advanceOrder()` therefore posts a
negative `ADJUSTMENT` line — netted against everything already posted for that
order — whenever an order reaches `REJECTED` or `CANCELLED`, inside the same
transaction as the status change and the `event_log` row.

**Why automatic and not a desk approval.** The kitchen already has to type a
reason a guest will read; asking it to also remember a credit puts the hotel's
mistake on the guest's bill until someone notices. The alternatives were worse
in specific ways: a staff-approved reversal needs an admin panel that does not
exist until P3, and moving the charge to the `ACCEPTED` transition would make
"Charged to room 214" false at the moment the guest is told it.

**Why a negative row and not an edit.** DATA-MODEL §5, and the
`folio_lines_recompute` trigger sums every non-PAYMENT line, so the totals
follow on their own. The original charge stays visible: at 7am on checkout day
the guest and the desk can both see that dinner was charged and then credited,
which is exactly the conversation a deleted row makes unwinnable.

**Why it nets rather than mirrors.** `reverseFolioLinesForSource()` sums what is
posted against the order and posts the opposite of the net, so a second call
credits nothing and a charge already partly credited at the desk is only
credited for the remainder. Combined with the compare-and-set on the transition,
that is #8 satisfied twice over — two tablets rejecting one ticket produce one
credit, proven under real concurrency in
`tests/integration/advance-order.test.ts`.

**What this licenses.** The guest's tracking screen may now say "nothing has
been charged for it" on a rejection. That sentence is a promise about the money,
and `track.test.ts` fails if it is ever softened while the reversal stands — or
kept if the reversal goes.

**Cost / when to revisit.** A hotel that wants a manager to sign off credits
above some amount will need the approval path after all. That is a rule on top
of this, not instead of it: post the credit, flag the folio, let the desk see
it — never leave the guest holding the line.

### D-028 · The SLA sweep runs in-process, and finds its work through a SECURITY DEFINER function
Breaches escalate on a 60-second timer started in `startLifecycle()`, not from a
route and not from an external scheduler. One instance sweeps at a time through
`pg_try_advisory_lock`; the level check makes a double sweep a no-op anyway.

**Why in-process.** The app is a persistent Node process (D-002), so this needs
no queue, no cron container and no dependency. A sweep triggered by traffic was
the alternative and it is wrong in the obvious way: it stops escalating the
moment a hotel goes quiet, which is exactly when a forgotten request matters.

**Why a SECURITY DEFINER function to find the work.** A job on a timer carries no
request, so there is nothing to derive a tenant from — and `app_user` under RLS
with no `app.tenant_id` correctly returns zero rows, which would make the sweep
silently do nothing for ever. `sla_sweep_properties()` (migration 0004) is the
same shape as `resolve_qr_routing()` (D-003 era, migration 0003): one fixed
statement, owned by the migration role, returning ROUTING IDS ONLY. The sweep
then re-enters through `withTenant()` per property and does every read and write
under RLS like the rest of the codebase.

The alternatives were worse in specific ways: connecting the worker as the owner
puts credentials that bypass every policy into the deployed image, which D-025
exists to prevent; loosening RLS on `service_requests` is row-level, so it would
widen every request path and not just this one; and a list of tenants in an env
var is wrong the day a property is added, with nobody noticing until a breach
goes unescalated.

**Escalation is not a status.** It moves `escalated_at` and `escalation_level`
and leaves the status alone (DATA-MODEL §6) — a breached request is very often
IN_PROGRESS, and collapsing that into an enum loses the only fact the duty
manager needs.

**Three levels, then it stops.** Level 1 at the breach tells the assignee, level
2 at ten minutes past tells the duty manager, level 3 at half an hour is a
failure on the manager's own board. Escalating for ever is noise that gets muted,
and a muted alert is the failure this mechanism exists to prevent.

**Cost / when to revisit.** Two things are stand-ins. The duty manager is whoever
holds PROPERTY_ADMIN, which becomes a `shifts` lookup when a property runs a real
rota. And nothing DELIVERS the notification rows yet — the channel is a product
decision needing an external service (CLAUDE.md says ask), so the row is written
and the drainer is the next decision. Writing the row first is deliberate: "we
never told them" and "we told them and their phone was off" are different
problems, and only a row written before the send can tell them apart.

### D-029 · The in-app bell is the notification channel, and delivery happens on the recipient's own render
`notifications` rows have been written before anything was sent since the SLA
sweep landed (D-028, DATA-MODEL §8). Nothing sent them, which was the one
asterisk on P2's exit criterion: a duty manager not already staring at the floor
board was not actually interrupted by a breach.

The channel is **in-app** — a bell in the ops console's shell and in the floor
board's header — and only in-app. `PUSH`, `WHATSAPP` and `EMAIL` remain rows and
nothing more.

**Why in-app and not WhatsApp.** WhatsApp is the one a GM would actually notice,
and it is a P5 objection-killer worth pulling forward. It also needs an external
service, which CLAUDE.md says to ask about first. The bell needs nothing, works
today, and is worth building either way: it is the fallback when a channel fails,
and a drainer needs somewhere to mark things delivered. Asking about WhatsApp
first and building nothing in the meantime would have left the asterisk standing
for the sake of a question that can be answered later without unpicking this.

**Why delivery is a write during a render.** `deliverInApp()` runs in the same
transaction as the bell's read, in `src/components/alerts.tsx`. For this channel
there is no other honest moment: a row is SENT when a screen belonging to the
recipient has it, and that screen asking IS the delivery. Marking rows SENT at
write time would make the status claim a screen had it when nobody was logged in,
and that is precisely the distinction the table exists to preserve — "we never
told them" versus "we told them and nobody was looking".

The payoff is the diagnostic half. A row still PENDING an hour after a breach
means the duty manager has not opened a screen since it was queued, which is a
real answer to a real question. The cost is that a prefetch of an admin page can
mark rows delivered a moment before a human looks. That is the right side to be
wrong on: the alternative is a client round trip on mount, and an alert reading
"nobody has seen this" while it sits on an open screen.

**Why the drainer is scoped to one staff member.** So the night porter opening
the console does not clear the evidence that the duty manager never did.

**Why a fourth stream rather than a fifth filter on an existing one.** D-026's
rule, unchanged: the transport is shared (`useLiveRefresh`), the authorize step
and the filter are written out per route. `/api/notifications/stream` is the
first one that filters on the RECIPIENT as well as the property — an alert is
addressed to a person, and a filter that dropped the staff id would put a duty
manager's escalations on every bell in the hotel. It checks a session and a
property rather than a permission, because there is no useful
`notification:read`: the question is not "may this role read alerts" but "is this
your alert", and the answer is the staff id in the cookie, never anything a
caller sends.

**Why the bell is on the floor board too.** Level 1 of an escalation goes to the
assignee, who is a housekeeper holding a phone, not a manager in the console. A
bell only on `/admin` would have delivered two thirds of what the sweep writes.

**Why `pnpm demo:reset` now seeds a breach.** SR-4468 is fourteen minutes past
its promise, escalated by calling `escalateBreachesFor()` rather than by writing
`escalation_level` and a notification row by hand — a seeder that hand-rolls what
the product does keeps working after the product breaks. Without it every demo
and every e2e run starts with an empty bell and a board with nothing late on it,
and the only way to see the second half of P2 is to sit watching a screen for a
quarter of an hour.

**Cost / when to revisit.** The bell is delivery to somebody who is looking at a
screen. It is not an interruption: a GM who has gone home learns nothing. That is
the WhatsApp decision, still open, and it is now additive — the drainer, the
statuses and the template renderer are all channel-agnostic, so a second channel
is a sender and a row filter, not a rework. Revisit when a property asks to be
told away from the desk, which is the question to put to a pilot rather than to
answer here.

### D-030 · The request catalog is editable, and four of its fields are not the property's to set freely
`request_types` has been "the property-configurable catalog… ops team
self-serve" (DATA-MODEL §7) since S6, and until `/admin/requests` the only way to
change "towels in 12 minutes" was to edit `provision.ts` and re-run the seeder,
which also wipes the property. The screen closes that.

Four columns it exposes are read by something load-bearing and were reachable by
nobody who owns the answer: `sla_minutes` is what the SLA sweep escalates
against, `route_to_role_key` is what the auto-router matches on, `price_minor`
decides whether a guest meets the one verification prompt, and `is_active` is
what takes a thing off the guest's list for a season.

**What a property may not do, and why each one is a real failure rather than a
tidiness rule.** The checks live in `type-rules.ts`, pure and unit-tested, and
`admin.ts` throws them — so a hand-posted form is refused the same as a click.

- **The key is minted once from the name and never changes.** Code finds
  `CALL_SERVICE` by key, and a key that moved when someone fixed a typo would
  break the one-tap screen with no error anywhere. Renaming is safe and the form
  says so.
- **`is_chargeable` is derived from the price, never set.** The guest's amenities
  card prints "Free" or the amount from the flag; the verification prompt is
  decided by the request's TOTAL. Let the two disagree and the worst case is a
  screen promising Free above a request that charges the room and stops to ask
  who the guest is — #9 broken by a checkbox. One number, not two, the same
  discipline `sla_minutes` already follows as both the promise and the deadline.
- **`CALL_SERVICE` may not carry a price.** `raiseServiceRequest()` requires the
  CHARGE tier as soon as a request totals more than zero, so ₹1 on the one tap
  turns "someone comes up to room 214" into a verification prompt. That is the
  exact screen CLAUDE.md #9 exists to keep out of the way. The field is disabled
  and says why; a property that wants to charge for something adds a type.
- **The routing role has to exist at the property.** Routing matches
  `route_to_role_key` against the roles staff hold. A typo, or a role never
  created here, produces a `NOBODY_WITH_ROLE` event on every request of that type
  for ever — the router working perfectly and nobody coming. Existence is checked
  and refused; HEADCOUNT is only shown, because a property building its rota
  before it hires is doing the normal thing. `listRolesAtProperty()` returns the
  count for exactly this, and the row says "goes to Concierge, and nobody holds
  it" in saffron when it is zero.

**Why the SLA floor is 1 minute and the ceiling is 8 hours.** A zero-minute
promise is breached on the way to the board, so the sweep escalates it before
anyone could have reached it — a setting whose only effect is to fill the duty
manager's bell. Past eight hours it is a maintenance job, not a service request,
and the SLA machinery stops meaning anything.

**Off and archived are different states, and both are needed.** Off is a season:
the type leaves the guest's list, the row stays on the admin screen so it can be
turned back on, and requests already open carry on. Archived is for good, and is
refused while anything of that type is still open — the same reason the menu
refuses to archive a section holding dishes. The person tidying the catalog is
not the person holding the trolley, and a type that vanishes mid-shift takes its
"what is this for" with it. Nothing is ever deleted (D-008): the FK from
`service_requests` is ON DELETE SET NULL and exists for analytics, and the lines
snapshot their own label (#6), so a finished request still reads correctly after
its type is gone.

**Who may change it.** `request:read` to look, `request_type:manage` to change —
the same split the menu editor makes with `catalog:read` and `catalog:manage`.
There is deliberately no `request_type:read`: a housekeeper wondering why towels
are twelve minutes should be able to find out, and nothing on the screen is a
secret from someone already working the floor. Only PROPERTY_ADMIN holds
`request_type:manage` by default, because changing an SLA changes what the sweep
escalates against and changing a routing role changes whose phone rings.

**Cost / when to revisit.** There is no reordering: `sort_order` is set to the
end of the list on create and never edited, so the guest's order is the seeded
one plus new types at the bottom. That wants drag-and-drop rather than a number
field, and nobody has asked. Categories are the fixed four the guest screens
group by — a fifth is a guest-side change, not a config one.

### D-031 · Answering the one prompt grants FULL, not CHARGE — and the folio is the screen that needed it
`ACTION_TIERS` has put `view_folio` and `request_checkout` on the FULL tier since
S5. `answerChallenge()` granted CHARGE. Nothing else in the product granted FULL,
so the top rung of the ladder was unreachable by any path — which went unnoticed
because nothing needed it until P3's folio screen, where it would have produced
an endless prompt: answer correctly, land on CHARGE, still be short of FULL, be
asked again.

**A verified guest gets FULL.** D-012 calls this "the ONE verification prompt in
the product", and a guest who proved the phone number on the booking in order to
send dinner up must not meet it again on the way to their own bill. The proof
does not get stronger between the two: whoever can answer it can already post
₹4,000 to the room, and reading what was posted is strictly less harmful than
posting it.

**A staff vouch still grants CHARGE**, and that is what keeps the two rungs
apart. The gap between them is about WHO vouched, not how much money is at
stake — the desk saying "yes, that is the guest in 214" is enough to let a charge
through, and is not enough to hand over the guest's bill. A desk that means to do
both passes `grantedTier: 'FULL'` and says so.

**Why the folio is gated at all, given #9.** #9 protects BROWSING — menus,
prices, POIs and free service calls — and a folio is none of those. It is the
one screen on the guest surface whose content is personal, and a QR sticker is
photographable from a corridor, a lift, or a Google review photo. The same
sticker that must never gate a menu must not hand a stranger the room's spend.

**The tier is only READ while rendering.** `requireTier()` writes an
`access_escalations` row, and the room home reaches this page through a `<Link>`
that Next prefetches as soon as it is in the viewport — so starting the challenge
during render would mint an escalation and a `verification_challenges` row for
every guest who merely scrolled past the row. Both are load-bearing counters:
abandonment rate is how D-012 says a property discovers its `escalation_trigger`
is too aggressive, and challenges count failed attempts PER ROOM towards a
lockout. The page renders the field with nothing behind it and the first submit
starts and answers in one call.

**The reference's folio copy is false and does not win.** Its `stay` screen is a
mock with no folio behind it, and its footnote — "Room and taxes settle at
checkout. Nothing here is charged yet." — stops being true the moment a room
charge is posted, which the seeder does on the first night. CLAUDE.md says the
reference wins when it and `theme.css` disagree; that is about design values, and
it does not license telling a guest their bill is empty while ₹21,540 sits above
the line. Same layout, same type, same measurements, true words.
`buildGuestStatement()` is where that lives: the label above the total and the
note under it both follow what is actually on the folio, so "Total so far"
becomes "Left to pay" the moment a payment lands and the number stops being the
total.

**Cost / when to revisit.** The statement recomputes its own total from the lines
it drew rather than reading `folios.balance_minor`. The header is the hotel's
authority and the recompute trigger maintains it; this is the guest's page, and a
total that does not equal the list above it is the one thing a bill may never do.
If the two ever disagree the guest still reads a self-consistent page while
somebody finds out — and the integration suite asserts they agree.

### D-032 · A cancelled service request credits the room, the same as a rejected order
D-027 gave `advanceOrder()` a reversal on REJECTED and CANCELLED and explained
why at length. The requests path never got it. `raiseServiceRequest()` posts the
folio line at placement exactly as `placeOrder()` does, so the charge was real and
nothing took it off.

The result was a real bug rather than a theoretical one: a guest could raise ₹450
of laundry, cancel it from their own screen, read "Cancelled" — and still be
charged, with the request screen truthfully reporting "₹450 is on room 214,
settled at checkout". It survived because nothing showed a guest their folio, so
the only way to notice was to reconcile a bill by hand at checkout.

Building P3's folio screen is what surfaced it: the first integration test that
cancelled a chargeable request and then read the bill failed on the missing
credit.

The fix is D-027's, applied: a negative ADJUSTMENT netted against what is posted
for that request, inside the same transaction as the status change and the event
(#7), with `service_request.charge_reversed` in the log. Idempotency comes from
the same two places — the compare-and-set on the transition, and
`reverseFolioLinesForSource()` netting rather than mirroring.

The guest's request screen changed with it, and had to: it said "₹450 is on room
214" under the word "Cancelled". It now says the charge came back off, and — like
the order timeline's equivalent — promises a NET of zero rather than the
existence of a credit row, so a free request with nothing to credit is still
telling the truth.

**What this says about the pattern.** Two charge paths, one of which had the
reversal and one of which did not, for four sessions. The seam is
`postFolioLine()` at placement and a reversal at the terminal states, and there
is nothing that enforces the pair — a third charge path (late checkout fees are
next) can forget it in exactly the same way. Worth a shared helper the day the
third one lands, rather than a third copy.

### D-033 · Late checkout is a service fee; another night is a booking, and we sell one of them
The design reference's `stay` screen offers three things: late checkout at 2pm
(₹2,500), late checkout at 6pm (₹5,000), and "Stay Thursday night" (₹18,500).
The product offers the first two.

**Why the night is not there.** Pricing a night means knowing a nightly rate,
and a nightly rate is a rate plan for a room type on a date. CLAUDE.md #11
forbids putting a price on `rooms` precisely so that this question cannot be
answered by a shortcut, #12 reserves `rate_plans` and `rate_calendar` for the
booking module, and D-013 removed the eleven tables that would have held them.
`extendStay(stayId, newCheckout)` is on the `PmsAdapter` interface
(EXTENSION-POINTS §B) — extending a stay across a night is a PMS operation, and
the price comes from whoever owns the inventory.

The reference could hardcode ₹18,500 because it is a mock with no hotel behind
it. Drawing the same button here would mean either inventing a rate or asking the
guest to agree to a number the desk fills in later — and a guest agreeing to an
unknown amount is worse than not offering it. The screen says "Staying another
night? The front desk arranges that one — the rate depends on the date", which
is true and is an answer.

**A tier is an HOUR, not a duration.** `checkout_fee_tiers.hour` is the new
checkout time; "three extra hours" is derived from the stay's own checkout, so
one row reads correctly for a guest due out at 11am and for one due out at 1pm.
Only the editorial line ("The room is yours all day") is stored, because it is
the only part that cannot be derived.

**Why the fee posts on APPROVAL and not at placement.** Every other charge path
in this product posts when the guest commits — `placeOrder()` and
`raiseServiceRequest()` both do, so "charged to room 214" is true the moment the
guest is told it, and both then need a reversal for the cases that do not happen
(D-027, D-032). This one is inverted on purpose: a guest who asks for 2pm has
received nothing until somebody says yes, and a request that charged on the ask
and refunded on the decline would put the hotel's "no" on the guest's bill twice,
as two lines they have to read past for the rest of the stay.

So the fee is SNAPSHOT at request — the amount the guest agreed to, which the
desk may override but not silently inflate — and POSTED once, on approval. The
useful consequence is that this path needs no reversal to pair with, which is the
failure D-032 records: two paths that post at placement, one of which forgot to
reverse, for four sessions.

**Approval is three writes or none.** Moving `scheduled_checkout_at`, posting the
fee and extending every live session happen in one transaction. A session expires
at `scheduled_checkout_at + grace`, computed when it was minted — so approving a
6pm checkout without the third write leaves the guest paying for a room whose app
stops working at 1pm. Each of the three is discovered by the guest rather than by
us, which is what makes splitting them the wrong kind of cheap.

**Both fee numbers are kept.** `fee_minor` is what the guest agreed to,
`overridden_fee_minor` what the desk charged, and the event carries both. "Why is
this ₹1,000 when the app said ₹2,500" has to be answerable from the log. A waiver
is an override of ZERO, so the effective fee is `overridden ?? agreed` and never
`overridden || agreed` — the second charges the full fee every time somebody
waives one, silently, and there is a unit test that says so.

**One open request per stay**, as a partial unique index rather than an
idempotency key. The constraint is true however the second row arrives — a double
tap, a second tab, a second device — and it means the desk decides one thing at a
time. `requestCheckoutChange()` returns the existing row instead of raising, so a
double tap is invisible to the guest (#8). Decided requests free the slot, which
is why a guest can be approved for 2pm and go on to ask for 6pm.

**Cost / when to revisit.** There is no screen for editing the tiers — they are
seeded, the way request types were before `/admin/requests` existed, and the same
argument will apply the first time a property wants to change ₹2,500 without a
seeder. Early checkout is modelled as a request with no fee rather than as its
own thing, which is right while checkout means settling at the desk and will want
revisiting when express checkout (P3's remaining bullet) can actually end a stay.

### D-034 · The verification lockout counts wrong answers, not attempts
`assertNotLockedOut()` summed every attempt on a room's challenges in the lockout
window, successful ones included. Five is the cap, and a successful challenge
contributes at least one — so a guest who verified correctly on their phone, then
on the tablet, then on their partner's phone, then again after a session lapsed,
was locked out of their own room for thirty minutes having never once got it
wrong.

The control exists to make a four-digit answer un-guessable (DATA-MODEL §3). A
correct answer is evidence of legitimacy, not of guessing, and counting it
punished exactly the person the control protects — a family with three phones in
one room, or anyone whose session expired while they were out.

Now a challenge contributes `attempts - (succeeded ? 1 : 0)`: one that succeeded
on the third try still carries its two failures, and only the successful attempt
itself is forgiven. Five WRONG guesses per room per window is unchanged, which is
the property that was ever load-bearing.

Found by the e2e suite rather than by a guest: the checkout tests verify once per
test on one room, and the run locked itself out. The suite's rooms are a shared
resource and that is a known cost, but a test suite hitting a limit five times in
a minute is a plausible family on a bad wifi day.

### D-035 · Checking out is four writes, and an unpaid balance is not one of the reasons to refuse
`stay_status` has had `CHECKED_OUT` since migration 0000 and nothing ever set it.
`revokeSessionsForStay()` was written in S7 and its only caller was a test. So
CLAUDE.md #10 — "session tokens are stored as SHA-256 hashes only, and are
revoked at checkout" — was true in the same way an unreachable branch is: no
checkout had ever happened.

`checkOutStay()` does four things in one transaction, and each is discovered by
the guest rather than by us if it is left out:

1. **The stay becomes CHECKED_OUT**, which frees the room — D-007's partial
   unique index only counts `CHECKED_IN`, so the next arrival can be put in 214
   the moment this commits.
2. **Every session on the stay is revoked** (#10). This is what stay-scoped
   sessions were always for: the QR sticker on the nightstand is unchanged and
   still public, and the phone that scanned it this morning stops being able to
   order to the room this afternoon. The next guest scans the same sticker and
   gets their own stay.
3. **An APPROVED late checkout becomes COMPLETED**, which is the only way that
   state was ever going to be reached (D-033 left it unreachable), and a
   REQUESTED one is cancelled — nobody is going to decide it for a room that is
   already being cleaned.
4. **The event records the balance** at the moment they left.

**Why an unpaid balance does not block it.** It would in a hotel that could take
the money. This product cannot yet: settlement is a later P3 bullet and
`postFolioLine()` deliberately cannot post a `PAYMENT`, because a payment also
needs a `payments` row. So the desk settles by card machine or cash and records
the departure here. A refusal would make the feature unusable and teach the desk
to work around the screen, which is worse than an honest number on it — and the
number goes on the EVENT, so "they left owing ₹13,180 and the desk checked them
out at 11:04" stays answerable after the balance stops being collectable.

**Why the room list is three queries and not one join.** `identity` owns rooms,
`stay` owns stays and guests, `billing` owns folios. A single SELECT touching all
three would be D-001 leaking out through the one screen that happens to need
everything. Three round trips for thirty-four rooms is the same cost either way,
and `folioBalancesForStays()` exists so the third is one query rather than one
per room — the mistake `provisionProperty()` made before it was batched.

**Check-in has no function of its own.** It is `createStay()`, which already
takes a staff actor and already turns D-007's 23505 into a sentence a desk can
act on. The action is its second real caller after the seeder, which is exactly
what #4 was written for; booking becomes a fourth rather than a sixth code path.

**The checkout hour is on the form, not in the code.** There is no
property-level standard checkout time anywhere in the schema, and defaulting to
11 inside the action would have been a business value living in a form handler.
The desk picks it and sees what it picked. When a property setting arrives, the
select gets a default and nothing else changes.

**What is still missing.** Guest 360 — a guest's history across stays, their
orders, their requests, their folio in one place. The room list carries the
answer to "who is in 214 and what do they owe", which is the desk's minute-to-
minute question; the rest is the conversation that happens when something has
gone wrong, and it wants its own screen.

### D-036 · One guest per tenant, one profile per property — and the property's view is what a screen edits
`guests` is keyed on `(tenant_id, phone)` and never on property
(EXTENSION-POINTS §2), so a group's returning guest is one row and their history
follows them between hotels. What each hotel thinks of them — VIP, a charging
hold, dietary flags, the note somebody left at 2am — is
`guest_property_profiles`, one row per property. `/admin/guests/[guestId]` reads
both and edits the second.

**Stays at sister properties are counted, not detailed.** They are the same
customer to the tenant and none of this front desk's business line by line: a
number ("3 elsewhere in the group") is the fact a desk can act on, and a list of
another hotel's folios is not. The property filter is explicit in every query
here because the RLS policies are tenant-scoped — without it a group's other
hotels appear, which is a leak the database will not catch for you.

**Two fields on this screen are not decoration.** `charging_blocked` refuses
every charge to the room, and `dietary_flags` prints on every kitchen ticket the
guest sends. Both leave a diff in `event_log`: "who put a hold on 214, and when"
and "who took the nut allergy off" both have to be answerable. A save that
changes nothing writes no event — a no-op is not an audit record.

**The hold now covers both charge paths.** `placeOrder()` has honoured it since
P1 and `raiseServiceRequest()` did not, so a guest who could not order a chai
could still put ₹450 of laundry on the same room. It is conditional on the
request total for the same reason the tier check above it is: a hold on CHARGING
must never stop somebody asking for a towel (#9). Turning a billing dispute into
a guest who cannot call for help is the wrong failure, and it is the one #9
exists to prevent.

**Lifetime spend is computed, and `lifetime_value_minor` stays unused.** The
column exists, is written by nobody and read by nobody. The choice was to
maintain it or to compute from the folios, and computing wins here: a
denormalised total that nothing maintains is worse than no total, and one that
something maintains is a second source that can drift from the lines — which is
exactly why `folio_lines_recompute` computes the folio's own totals in the
database rather than trusting a caller. At 34 keys it is one indexed sum. If it
stops being cheap, the answer is a trigger-maintained total like the folio's, not
the column that has been sitting there.

### D-037 · A `ForbiddenError` says what the thrower wrote, like every other error
`ForbiddenError.publicMessage` was a class constant: `'You do not have permission
to do that.'` Five throw sites had each written a specific, actionable sentence
as the constructor argument, and every one of them was silently replaced by that
one before it reached a person.

The worst was the oldest. A guest whose card had been declined at the desk read
"You do not have permission to do that" when they tried to order dinner, instead
of "Charges to this room are on hold. The front desk can take the order" — and
had since P1. CLAUDE.md's own rule is that guest-facing messages "say what
happened and what to do; they do not apologise and are never vague", and the one
error class most likely to need a specific sentence was hardcoded to the vaguest
available.

It now behaves like `ValidationError`, `ConflictError` and `TooManyAttemptsError`:
the constructor argument is the public message. Found by building the guest 360
screen, whose charging hold is refused on a path the e2e follows all the way to
what the guest reads.

**The vague sentence is still available and still used, once.** `authorize()`
throws it deliberately: which permission is missing is a fact about our
authorization model and a staff member cannot act on it, so it goes in `context`,
which is logged and never sent. The difference is that the vagueness is now a
decision at the throw site rather than a property of the class.

**What this does not change.** `NotFoundError` keeps its fixed message on
purpose: it is what a staff member reaching across properties gets, and a
specific one would confirm the resource exists. That vagueness is a security
property, not an oversight, and the comment above it says so.
