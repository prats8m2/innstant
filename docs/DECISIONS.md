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

### D-038 · The PmsAdapter is an outbound seam, not a facade over every stay operation — SUPERSEDES the interface sketch in EXTENSION-POINTS §B
EXTENSION-POINTS sketches the boundary as a facade over everything a reservation
system does:

```ts
interface PmsAdapter {
  findStayByRoom(propertyId, roomNumber): Promise<Stay | null>;
  listArrivals(propertyId, date): Promise<Arrival[]>;
  checkIn(stayId): Promise<Stay>;
  checkOut(stayId): Promise<Stay>;
  extendStay(stayId, newCheckout): Promise<Stay>;
  postCharge(stayId, line: FolioLine): Promise<PostResult>;
}
```

Written that way it would be wrong in two specific ways, both of which only
became visible once the operations existed.

**A remote system cannot be inside our transaction.** Approving a late checkout
moves `scheduled_checkout_at`, posts a `CHECKOUT_FEE` line and extends every live
session, in ONE transaction (D-033). Checking out does four things in one
(D-035). An `extendStay()` that makes an HTTPS call in the middle of either
choice holds a database transaction open across the network, or commits half the
work when the call fails. DATA-MODEL §8 already decided this: "a hotel's Opera
instance being down must never fail a guest's order." The local write is
authoritative and synchronous; the PMS is told afterwards.

**The local table is the answer to every read.** `createStay()` is the only place
a stay is born (#4), so a PMS import is a caller rather than a bypass and every
stay exists in `stays` whatever produced it. `findStayByRoom()` has no caller
here and would be an unused method pretending to be a seam — the exact ceremony
that makes an interface stop being guarded.

**What the interface is instead.** The half that is genuinely someone else's:
telling the system of record what happened.

```ts
interface PmsAdapter {
  readonly kind: PmsKind;
  readonly deliversOutbound: boolean;
  deliver(event: PmsEvent): Promise<void>;
}
```

`PmsEvent` is a CLOSED union of the four things that happen here which a system
of record needs — checked in, checked out, extended, charge posted. Closed
because adding a fifth should be a compile error in every adapter; that is what
"guard the interface more carefully than the schema" buys. Payloads carry room
numbers and `source_ref_id` (§3) rather than our uuids, which mean nothing on the
other side, and money crosses in minor units like everywhere else (#5).

**Why `ManualAdapter` exists when it does nothing.** It answers
`deliversOutbound: false`, and that answer is what makes the check a question the
code asks rather than an assumption it makes. Every stay change already goes past
`notifyPms()`; an `OperaAdapter` flips the flag and those same call sites start
filling the outbox with no edit. Without it, "does this property have a PMS" is a
condition nobody wrote and the first real adapter is a rewrite of four call
sites.

Its `deliver()` throws rather than resolving quietly. A no-op would let a
mis-resolved adapter — or an enqueue for a manual property — look like successful
delivery, and the row would be marked DELIVERED with nothing on the other end.

**Why nothing is enqueued for a manual property.** A row per folio line for a
queue with no consumer is write-only rows at table scale, which is the pattern
this codebase keeps finding and deleting. The outbox is empty on every property
that exists today, and that is correct rather than incomplete.

**Why there is no `pms_provider` column.** EXTENSION-POINTS' own rule: keep the
changes that would need data reconciled later, drop everything purely additive. A
nullable text column added the day a hotel actually runs Opera costs nothing.
What matters is that `pmsAdapterFor()` is the one place that decides, so the day
it exists there is one line to change.

**Why the drain has no timer.** The queue is empty by construction today, and a
60-second sweep over it would need a third SECURITY DEFINER function to find work
with no request to derive a tenant from — D-028 called `sla_sweep_properties()`
"the second and last unscoped query in the product", and this would make it the
third for a consumer that does not exist. `drainPmsOutbox()` takes its property
from the caller, is tested against a failing adapter, and the timer is twenty
lines on the day a real PMS lands.

**Cost / when to revisit.** Two things are deferred rather than solved. Inbound
import — a PMS's reservations becoming `stays` with `source: PMS_IMPORT` — has no
implementation, and it is the other half of a real integration; it wants its own
adapter method and a scheduled pull, and neither can be designed properly against
an imaginary API. And ordered delivery is per property and per pass: a failure
stops the pass so nothing is reordered, but two drains running at once could
still interleave. One property's queue is small enough that a single drainer is
the right answer, and the day it is not, the advisory lock the SLA sweep already
uses is the same fix.

### D-039 · A payment is two rows written together, and the desk is a provider
`postFolioLine()`'s `source` union has excluded `PAYMENT` since P1 and nothing
could post one. `recordPayment()` is what it was waiting for.

**Why two rows.** A `payments` row is the ledger of how money actually arrived —
provider, method, reference, captured-at — and is the row a chargeback or a
cash-drawer reconciliation is answered with. A `folio_lines` row with
`source = 'PAYMENT'` is what `folio_lines_recompute` sums into `payments_minor`
and takes off the balance. Neither does the other's job:

- a `payments` row alone leaves the guest's bill showing its full amount after
  they have paid it;
- a folio line alone leaves a settled bill with no record of how it was settled.

They are written in one transaction and the generic door stays shut. The union
was the guard; there is now a runtime check as well, because a cast walks past a
union and this is a money path.

**`provider` is `DESK`, not `RAZORPAY`.** The money moved through a card machine
or a cash drawer. Recording it as a payment provider we do not use would make
reconciliation lie the first time somebody compared our `payments` table to a
Razorpay settlement report. Express checkout is the same two rows with
`provider = 'RAZORPAY'` and a webhook confirming them, and it needs an external
service nobody has chosen.

**Why `SETTLED` is explicit and not "balance is zero".** A folio hits zero in the
middle of a stay whenever D-027 reverses a rejected order, and that guest is
still here and still ordering. SETTLED means "this stay's account is closed",
which is a decision about the stay. `settleFolio()` refuses a non-zero balance
in both directions — a settled bill with money outstanding is the one thing the
status must never mean, and an overpaid one has to be returned before it closes.

`checkOutStay()` calls it when the bill is already square, which is what turns
D-035's "checking out does not take the money — the balance stays on the bill"
into an account that closes. An unpaid bill still leaves CHECKED_OUT with the
balance on the event, unchanged.

**Overpayment is allowed and visible.** A deposit before any charge is a real
thing, and so is a fat-fingered ₹130,000 for a ₹13,000 bill. Refusing would block
the first; the balance goes negative and the guest's own screen says "We owe you"
(D-031's statement already worded it), which is the honest state and the one a
desk can act on.

**Idempotent on a key the screen mints per render** (#8), the same shape the
cart's send button has used since P1. A double-click here is a second real charge
on a card machine and a refund somebody has to arrange, which makes it the most
expensive double-submit in the product.

**A payment is listed, not just totalled.** `buildGuestStatement()` was dropping
the PAYMENT lines after summing them — correct that they must never read as
charges, wrong that a total is enough. "Paid ₹450" without "Card · 4242" is
missing the half of a bill a guest actually checks: that the right card was
charged. They have their own list now, drawn in teal like a credit, because both
are money coming off the bill rather than going on it.

**Cost / when to revisit.** No refunds. `payment:refund` exists as a permission
and PROPERTY_ADMIN is the only role with it, and taking money back is not the
same shape as taking it — it wants a negative `payments` row, a reason, and an
approval trail. The day a desk needs one is the day to design it, and it will
have this function's pair to copy. Nor is there a receipt: `folio.settled` is in
the log and the guest can read their own bill, but nothing emails them a PDF —
that needs an email service, which is the same conversation as Razorpay.

### D-040 · Setting the building up is its own screen, and a room is never created without its QR code
P3.5 exists because the plan did not. The six phases covered the guest-facing
product and its daily operation and never covered a hotel setting itself up —
P0's exit criterion was about ISOLATION ("two properties exist in one database"),
never about a human creating the second one, and P1 said so out loud for outlets:
*"a second outlet is created by `provisionProperty()`, not from a screen"*. The
same was quietly true of floors, rooms, staff and settings.

The measure of the gap, taken before the phase was written: **21 of 55 declared
permissions had no caller anywhere.** Three were P4's concierge. The rest were
things a hotel needs to run itself.

**Why `/admin/property` and not the front desk's `/admin/rooms`.** That screen is
about the DAY — who is in 214, what they owe, check them out — and it is open all
morning. This is about the building, which changes a few times a year. The menu
editor folds sections and dishes together because an F&B manager arrives asking
"where is this dish and what does it cost"; a front desk never arrives asking
"how many floors are there", and a delete-floor control in their way all day is
the wrong trade.

**A room mints its QR code in the same transaction, always.** This is the one
thing `provisionProperty()` guaranteed by construction and a screen could quietly
lose: a room with no code is invisible to the entire guest surface, and NO screen
would tell you, because every one of them assumes the code exists. The guest
would find out. `newPublicCode()` is exported from `provision.ts` rather than
reimplemented — two generators are two answers to "how guessable is a sticker",
and only one of them would get reviewed.

**Archiving a room revokes its code; restoring issues a new one.** Leaving the
code live on a room out of service means a sticker in a corridor that resolves to
a real property for ever. And a restored room gets a fresh code rather than its
old one back: the old sticker has been out of a guest's hands for however long
the room was shut, and a code that was dead on Tuesday and live on Thursday is
the wrong kind of surprise. The cost is that restoring means reprinting, which is
the honest trade.

**Floors are deleted, rooms are archived.** `floors` has no `archived_at` and an
empty floor has no history — nothing references it and no stay ever happened on
it — so a hard delete is right. A room is referenced by every stay it ever held
(D-008's reasoning), so it is archived. Deleting a floor is refused while ANY
room points at it, archived ones included: they hold the floor by FK, and their
old stays are still the answer to "where was this guest in March".

**An archived room keeps its number.** `rooms_property_number_uq` has no partial
predicate, so 214 stays taken. Rather than add one — which would let a new 214
exist beside an archived 214 and make "room 214" ambiguous in every conversation
at the desk — the screen says so and offers Restore.

**The occupancy guard is raw SQL inside `identity`.** Archiving a room has to
refuse while somebody is in it, and `stays` belongs to another module. The guard
is a read-only projection in the SAME transaction as the write, which is the
narrow exception the floor board and the desk's checkout queue already take
(D-001). Splitting it into the caller leaves a window where a guest checks in
between the check and the archive, and the first anybody hears of it is a guest
whose QR stops working.

**Cost / when to revisit.** Room types are not editable here — a room can only be
one of the types `provisionProperty()` created, and the screen says so rather
than pretending. That is the next item in the phase, along with staff and roles,
QR reprint and property settings. Client onboarding stays out entirely: creating
a tenant is above the tenant boundary, every page runs inside `withTenant()`, and
it changes the tenancy model.

### D-041 · A reprint kills the sticker and keeps the guest, because sessions bind to the stay
`room_qr_codes.version` has carried the comment *"reprinting a sticker
invalidates the old one"* since migration 0000, and `qr:regenerate` has been a
declared permission since S5. Neither was true of any code path in the product.
A sticker peels off the nightstand, gets covered in chai, or is photographed in
the lift by somebody who is not a guest — and the only route back was a database
write. This is the same shape as the rest of P3.5: a rule stated in a comment and
a permission stated in a list, describing behaviour that had never once run.

**The old code dies immediately.** `regenerateQrCode()` revokes every live code
for the room before issuing the new one, so `scanQrCode()` refuses the old one
from that moment. That is the entire point of the feature and the reason it has
its own permission rather than riding inside `room:manage` — killing a code that
strangers may be holding is a different act from renumbering a wing.

**It deliberately does NOT sign the current guest out.** Sessions bind to
`stay_id`, never to the room and never to the code (#10), so the phone already on
the nightstand keeps working; only a fresh scan needs the fresh sticker. This
looks like a gap and is the opposite. The room whose code got photographed is
almost always an OCCUPIED one, and a desk that believes a reprint evicts the
guest in it will not press the button — leaving the compromised code live, which
is the failure the feature exists to prevent. The control has to be usable at the
moment it is needed, and the UI says so where the desk reads it.

**`version` counts stickers printed, not stickers live.** It is derived from
`max(version) + 1` rather than a row count, so a room reprinted, taken out of
service and restored reads 1, 2, 3 — the number in `event_log` is the number on
the plastic. A count would let a row deleted by hand produce two stickers both
claiming to be the second, which is precisely the ambiguity an audit trail exists
to remove. `createRoom`, `restoreRoom` and the reprint now share one issuer;
three copies of that insert were three places for the numbering to drift.

**Refused on a room that is out of service.** Its codes are already revoked, and
minting a live one would hang a working sticker on a door the desk cannot put
anybody behind. Restoring the room is the way, and it issues one.

**The code is never logged** — not to `event_log`, which anything holding
`audit:read` can read, and not to `logger`, which is the output most likely to be
shipped somewhere else. The event carries the version, which says WHICH sticker
without saying what it opens. Same rule as `room.created` in D-040.

**Cost.** A reprint is not undoable: the previous code is gone and any sticker
already printed from it is scrap. That is correct — a revocation somebody can
reverse is not a revocation — but it means the control belongs behind a
disclosure rather than beside Copy link, which is pressed all day and is
harmless.

### D-042 · Room types are editable; there is still nowhere to put a price
EXTENSION-POINTS §1 calls `room_types` the single most expensive thing that could
be deferred: rates and inventory are priced per room TYPE, so booking cannot
exist without the table, and retro-fitting it means reconciling a varchar's typos
across live data. The table has existed since 0000. Only `provisionProperty()`
ever wrote to it — so a hotel that opened a new class of room could not describe
one, and `/admin/property` said so out loud rather than pretending: *"This
property has no room types, so a room has nothing to be."*

**#11 holds with no exception.** There is no price field on this form and no
`*_minor` column added to the table. A price belongs to a rate plan for a type on
a DATE — `rate_plans` and `rate_calendar` are reserved names (#12) and this is
the table they will attach to. A `nightly_rate` added "just for the setup screen"
would commit the model to per-type flat pricing before the rate calendar exists
to disagree with it, which is the same mistake #11 forbids one level down on
`rooms`.

**Retiring is refused while any room is that type.** `rooms.room_type_id` is NOT
NULL, so such a type cannot be deleted — and must not be archived either:
`listRoomTypes()` stops offering an archived type, so the rooms on it would point
at something the edit form can no longer re-select, and the first person to touch
an unrelated field on one of those rooms would be told to pick a room type that
is not there. Archived ROOMS count towards the refusal too, because they still
hold their type by FK and restoring one has to find it selectable.

**The count is shown before the button, not after the refusal.** The row reads
"14 rooms" beside Retire, the same way `listRolesAtProperty()` reports "Concierge
— nobody" so a manager cannot silently route requests at an empty rota. A refusal
somebody could have been shown in advance is a refusal that should have been.

**Codes are normalised on the way in** — trimmed, uppercased, and restricted to
letters, digits, `-` and `_`. "lkv", " LKV " and "Lkv" must not become three room
types at one hotel: a code is what a rate sheet, a PMS export and a channel
manager will key on, and the cheapest moment to make it canonical is before the
first row exists. A retired type keeps its code, for the same reason an archived
room keeps its number (D-040), and the screen offers Restore instead of a 23505.

**`max_occupancy` is recorded and not enforced.** Nothing in the guest product
counts heads, and the field's hint on the form says exactly that rather than
implying a check. It is collected now because rates and inventory will be priced
per type and backfilling occupancy across live properties later is the expensive
version of asking for it. `description` and `total_rooms` are deliberately NOT on
the form — nothing reads either, and a textarea nothing displays is the same kind
of dead surface this phase exists to remove.

### D-043 · The name and the clock are editable; the currency is write-once from the first charge
`property:update` has been a declared permission since S5 with nothing calling
it. `provisionProperty()` set the name, timezone and currency once, and nothing
could ever change them — so a hotel that rebranded, or one provisioned into the
wrong timezone by a typo, had a database write as its only route. The three sit
on `/admin/property` under "This hotel", above the building it is made of.

**The currency is the interesting one, and it is effectively write-once.** #5
says every row holding an amount carries its OWN currency beside its `*_minor`
integer. Changing `properties.currency` converts nothing and is not meant to: a
folio line written in INR stays INR for ever, which is correct, because it is
what the guest was actually charged. But from the moment the property switches,
new lines land on the SAME folio in the new currency, and `buildGuestStatement()`
would total a bill whose rows do not agree. There is no exchange rate anywhere in
this product, and render time is the worst imaginable place to invent one.

So the change is permitted only while the property has never priced anything —
no `orders`, no `folio_lines`, no `payments`. That is during setup, before the
first order, which is both the only moment it is safe and, realistically, the
only moment anybody wants it.

**One query, two callers.** The screen asks `currencyIsStillOpen()` to decide
whether the field is editable and what the hint says; `updatePropertySettings()`
asks the same function again inside the SAME transaction as the write, so a first
order placed between the render and the save cannot slip through. Two queries
here would be two answers to one question, and the screen's is the one people
would trust. Same shape as the occupancy guard in D-040.

**The field is `readOnly`, not `disabled`.** A disabled input posts nothing, and
"nothing" would arrive at a Zod schema that requires three letters — turning a
correct refusal into a validation error about a field the user could not touch.
Read-only keeps the current value in the post, so the server sees no change and
says nothing.

**Timezones come from `Intl.supportedValuesOf('timeZone')`, and validation uses
the same source.** A hand-kept list goes stale the first time a customer opens in
a country nobody thought of. More importantly, a bad zone is not cosmetic: kitchen
hours, availability windows, business-day rollovers and every time a guest reads
are property-local (CLAUDE.md "Dates"), so `Asia/Kolkatta` stored today surfaces
weeks later as a guest reading "by 3:26 am" rather than as an error now.
`Asia/Calcutta` is a genuine IANA alias and is accepted, because the tz database
says so and we are not more clever than it.

**Saving revalidates the whole layout, not two routes.** The property name is in
the admin bar on every screen and the timezone decides what "today" means on the
kitchen's hours, the desk's due-out column and the guest's checkout day. A
targeted `revalidatePath('/admin/property')` would leave every other screen
rendering the old clock until something else happened to invalidate it.

**`branding` is deliberately absent.** It is a WCAG-validated token set rather
than a text field (D-016), it is the theme editor, and it belongs to P5.
`slug` is absent too: it is in a unique index with the tenant and changing it
would break links people have already saved.

### D-044 · An invite is a link a manager hands over, and a property is never left without an admin
`provisionProperty()` has created exactly one PROPERTY_ADMIN as INVITED with
`password_hash` NULL since P0, and S5 never built the flow that fills it in. So
the only account that could ever sign in was one the demo seeder wrote a password
for directly, a hotel's second staff member was a seeder run, and `staff:invite`,
`staff:update`, `staff:deactivate`, `role:read` and `role:assign` were five more
declared permissions with no caller. This is the item a pilot needs before any of
the others matter.

**The invite is a LINK, not an email, because there is no mail provider.**
Adding one is a decision rather than a session (CLAUDE.md "Ask before"), and the
honest thing in its absence is the shape a mail provider would send anyway: a
one-time URL the manager copies out of the screen and hands over — in person,
over WhatsApp, however they already talk to their staff. The same shape as the
guest link on the room list. When mail arrives it sends this link and nothing
about `staff_invites` changes.

**It is stored as SHA-256 only** (#10, the same rule as staff and guest session
tokens), so the plaintext exists exactly once, in the response that created it,
and travels back in the Server Action's own result rather than being fetched by
the row that displays it. Lose it and you issue another; there is nothing to
recover. It is never written to `event_log` — which anything holding `audit:read`
can read — and never to the logger.

**One live invite per person**, enforced by a partial unique index, the same
shape as D-007's one-CHECKED_IN-stay-per-room. Re-inviting revokes first, so the
newest link is always the only one that works. Without it, revoking the link a
manager can see leaves an older one alive — the exact opposite of what they just
did. 72 hours, because a link that sets a credential should not sit in a chat
window for a month.

**Accepting sets the password AND burns the token in one transaction**, then
issues a session and signs them straight in. A password written without
`accepted_at` leaves a live link that can set it again, which is a credential
reset anybody holding the old message can perform. And signing in here rather
than redirecting to the login form means somebody who has just typed a password
twice does not type it a third time.

**Every invite failure reads the same** — unknown, expired, revoked, already
used. One message, like `QrNotUsableError`: somebody probing the URL learns
nothing from which, and the person holding a real link needs the same instruction
either way, which is to ask for a new one.

**The invariant: a property is never left without an active PROPERTY_ADMIN.**
`assertNotTheLastAdmin()` guards both deactivation and role revocation, counting
everyone except the person being changed and excluding only DISABLED accounts —
an INVITED admin counts, because they hold the role and a link that makes them
able to use it, which is the same reasoning `listRolesAtProperty()` gives for
counting them in a rota. You also cannot switch off the account you are holding.
Without this a hotel locks itself out of its own console on a Tuesday afternoon,
with no route back that does not involve us and a database prompt.

**Deactivating revokes every session in the same transaction.** A staff session
lives for its TTL, so flipping the status alone would leave the kitchen screen
they are still logged into working until the cookie aged out. Their roles and
history stay — a DISABLED account cannot sign in at all, so removing the roles
would only lose the record of what they did and make a rehire a rebuild.

**Reactivating goes to INVITED, not ACTIVE.** Handing an old password back to
somebody who was walked out of the building is not a decision a "Switch on"
button should make silently, so the hash is cleared and a fresh link is the way
back.

**A role cannot be taken away if it is somebody's only one here.** An account
with no role at a property can sign in, sees a console with nothing in it, and
gives nobody any clue why. Switching the account off is the honest way to stop
somebody working here, and it is one button along.

**One email is one account per TENANT** (`staff_users_tenant_email_uq`), which
D-006 made deliberate: a group with six hotels is one tenant, and its F&B manager
is one person with roles at three of them, not three logins. So "invite anita@ to
this property" is a new row the first time and a new `staff_property_roles` grant
every time after — one button, because the manager cannot see which case they are
in and should not have to. An already-ACTIVE colleague gaining a second property
gets no link at all: they have a password, and minting one would put a live
credential-setting URL in a chat window for nothing.

**The invite page is the second and last signed-out staff page**, and the
middleware's exempt list now names both. Gating it would redirect a new staff
member to a login form for an account they cannot yet log in to. Which tenant a
signed-out browser belongs to is the open tenancy question `/admin/login` already
documents; `login/tenant.ts` now holds that single stopgap answer so both pages
change in one place when it is settled. No third unscoped query was added —
`resolve_qr_routing()` and `sla_sweep_properties()` remain the only two, and the
invite token is resolved under `withTenant()` like everything else.

**Cost / when to revisit.** There is no self-service password reset: a staff
member who forgets theirs asks a manager for a new link, which is the same
mechanism and one more person. That is acceptable at a single hotel and will not
be at fifty — and the fix is the mail provider that is already the prerequisite
for the reset flow, so nothing here has to be undone first. Custom roles are
assignable but not yet creatable; `roles.property_id` and
`roles_tenant_property_key_uq` have supported them since 0000, and `role:manage`
is still a permission with no caller.

### D-045 · A page with no session redirects; only an action throws
Found by the P3.5 staff e2e: somebody switched off mid-shift, reloading the
screen they were already on, got **"Application error"** instead of the sign-in
form.

The mechanism was three years of correct comments pointing at each other.
`src/middleware.ts` is explicit that it is a cookie turnstile and nothing more —
the edge runtime cannot open a TCP connection to Postgres, so it waves through
anybody HOLDING a cookie, including one that has been revoked or has expired, and
says so out loud: *"treat a redirect from here as a UX affordance, never as a
security boundary."* `guard.tsx` was equally explicit that a thrown error in a
Server Component has no mapping to run and renders the error boundary — which is
exactly why `adminAccess()` exists for the PERMISSION case. Between them,
`requireStaffSession()` threw `UnauthenticatedError` from inside every page, and
nobody had joined the two comments up.

It was reachable the whole time — an ordinary session expiry did it — and went
unnoticed because nothing could revoke a session mid-shift. `deactivateStaff()`
(D-044) revokes every session in the same transaction as the status change, which
made it happen on purpose, in front of a test, on the surface where it matters
most: an always-on kitchen tablet.

**The rule, stated once so it stops being rediscovered:**

| Caller | No session |
|---|---|
| Page (Server Component) | `getStaffSession()`, then `redirect('/admin/login?next=…')` |
| Server Action, route handler | `requireStaffSession()` / `requirePermission()` — throw, mapped to a status in one place |

`adminAccess()` and all three ops surfaces now redirect. `requireStaffSession()`
keeps exactly one caller — a Server Action — and its doc comment now says pages
must not use it.

**A missing PERMISSION still renders a sentence, not a redirect.** They are
signed in; sending them to a login form they have already passed would be a loop,
and "this account cannot do this" is the true and actionable thing to say.

**The pathname comes from the middleware.** Next does not hand a Server Component
its own URL, and the middleware is the only code that sees it, so it forwards
`x-pathname` and `requestPathname()` reads it back — rejecting anything that is
not an internal path, the same check `safeNext()` already makes on the other
side.

### D-046 · The ops console gets a rail, panels and shared column tracks
The console had grown eight screens on a layout built for two: one 960px column,
a wrapping top bar of every link, and a single `.dish` row class doing duty for
dishes, rooms, floors, room types, staff, roles and request types. It worked, and
it did not read as a thing a hotel runs its day on.

**The evidence was already in the stylesheet.** Three separate comments described
fighting the same problem — `.typeForm`, `.checkoutDecide` and `.roomForm` each
set `flex-basis: 100%; order: 1` to escape a flex row that squeezed them, and one
of them says out loud that "nine fields as a flex item squeezed the name into a
three-character column". A fourth comment records the top bar covering a page at
412px once a sixth nav item made it wrap. Each was patched where it hurt.

**The rail.** Navigation moved to a left rail with named groups (Today, Service,
Setup, Floor screens). A console has horizontal room and no vertical room, which
is the axis the bar was competing for; a rail also has somewhere to put group
names, so eight destinations stop being one undifferentiated list. Below 960px it
lies down into a strip that SCROLLS rather than wraps — wrapping is what put a
sticky second line on top of the page.

**It is filtered by permission.** The front desk could see Menu, Property and
Staff and got a refusal from each. A console full of links that refuse is how
staff learn not to trust the console. Presentation only: every page re-checks
server-side and every action checks again.

**Panels.** A section is a bordered card with a header strip instead of two lines
under a hairline. Six sections on the property screen previously had no edges at
all, so there was nothing to tell a GM where floors stopped and rooms began.

**Rows are a grid with shared tracks.** `.dish` is `grid-auto-flow: column` with
one flexible first track, so a row with four controls and a row with two do not
wrap differently — a fixed `1fr auto` template put the third control on its own
line, which is what made every staff row and every empty room two lines tall.

The front desk goes further and uses `subgrid`: the LIST owns six tracks and each
row borrows them. Per-row grids were not enough, because an `auto` track sizes to
its own row's content — an occupied room (Vouch, Check out) and an empty one
(Check someone in) produced different widths, and the header printed STICKER four
hundred pixels from the stickers. The board went from 4,728px to ~3,100px for the
same 34 rooms, one line each, with columns that line up.

**Row forms are anchored, not inserted.** A `<details>` that belongs to a row now
opens as a panel positioned against it. Inserting it pushed thirty rooms down the
page and moved the row out from under the cursor, and no `grid-column` reaches a
form nested two elements deep inside a cell — which the reprint form is. The cost
is that `.section` gives up `overflow: hidden`; below 960px it goes back to being
an ordinary block, because a 600px panel anchored to the right of a 380px screen
is off it.

**Three status tones, named for meaning.** `--status-positive`,
`--status-attention`, `--status-critical`. One saffron span had been carrying
"out of service", "you", "retired", "not signed in" and "switched off", and a
Delete button read exactly like a late ticket. `--clay` is the new colour and
clears AA on all three surfaces (asserted). Destructive buttons are outlined
rather than filled: findable without dragging the eye down a column of thirty.

**`data-available` was two opposite things.** It meant "dish is on tonight",
"type is not archived", "account is not disabled" — and on the front desk "room
is EMPTY". The CSS dimmed `[data-available='false']`, so every occupied room, the
rows a desk actually works from, rendered its number in the faintest colour on
the page. Visual state is now `data-muted`, which says one thing.

**The overview became a dashboard.** It was ten cards, one per destination — the
front page doing the menu's job because the menu could not do it. The rail does
that now, so the page answers the question a GM actually opens it with: four
numbers (rooms occupied, requests open and how many are past their promise,
tickets up, checkouts waiting), then the things with a clock on them. Every
number comes from the service function the screen behind it already calls, and is
skipped entirely for an account that cannot open that screen.

**Cost / when to revisit.** `subgrid` is used on one list; where it is missing the
rows fall back to sizing themselves, which is what they did before. The room
board still shows three sticker buttons on every row — aligned now, but 102
buttons for something used rarely, and worth collapsing when the e2e no longer
needs each one addressable. Floor panels are separate grids, so column widths
differ slightly BETWEEN floors; within a floor, which is the scanning unit, they
agree.

### D-047 · A `<select>` must contain the value it is showing
Found by looking at the property screen after the panel work: The Kesari's
timezone read **Africa/Abidjan**.

Nothing had gone wrong with the write path. `Intl.supportedValuesOf('timeZone')`
returns whatever spelling the runtime's ICU considers canonical, and on the Node
this is built with that is `Asia/Calcutta` — while `provisionProperty()` stores
`Asia/Kolkata`, which is what every property in the product is on. So the list
had 418 valid zones and not the one zone that mattered.

A `<select>` whose `value` matches no `<option>` does not render empty. The
browser selects the FIRST option. The field then looks like a considered answer,
and the next submit posts it — so the e2e that types a new hotel NAME and presses
Save moved the hotel's clock to Ivory Coast, and every guest-facing time with it
(CLAUDE.md "Dates": everything a human sees is rendered in `properties.timezone`).

**The fix is the list, not the stored value.** `offeredTimezones(current)` appends
the current zone if the runtime does not offer it, sorted in. The obvious
alternative — canonicalise on write so stored always matches offered — makes the
database depend on the ICU build of whichever machine last saved: the same hotel
would read `Asia/Kolkata` on one Node and `Asia/Calcutta` on another. Both are
valid IANA identifiers and both resolve correctly. The one a property chose is the
one it keeps.

**The general rule, because this is not about timezones.** Any edit form that
renders a stored value as a `<select>` must guarantee the value is among the
options, or it will silently propose a different one and a save meant for another
field will take it. Unit tests cover the invariant; the e2e now reads the zone
before and after saving a name and asserts it did not move.

### D-048 · The palette was replaced wholesale, and the aliases had to move
The "Staff Console" design export is a different design system from the one the
product shipped on: paper ground, teal accent, ink text, Public Sans and Red Hat
Mono, 8–12px radii. The Kesari theme was deep indigo, saffron, lime plaster,
Marcellus/Mukta/DM Mono and a deliberate 2–4px radius.

`src/styles/theme.css` is shared by every surface, so adopting it moved the guest
PWA as well. That was the explicit call, taken with the alternatives on the table
(a staff-only token layer, or re-skinning the design's layout onto the Kesari
tokens). It is recorded here because the consequence is not obvious from the
diff: the guest app's visual identity changed without a line of guest code being
touched.

**The old names survived, remapped by role.** `--plaster` is now near-black,
`--ink-800` is now white, `--saffron` is teal. ~250 usages across the module
stylesheets reference the indigo ramp directly, and rewriting them all was a far
larger and riskier change than defining them as aliases of the new palette. The
legacy block is documented as deprecated and `theme-discipline.test.ts` keeps
every alias that something still uses from being deleted out from under it.

**The thing that actually cost time.** A custom property whose value contains
`var()` is resolved on the element it is DECLARED on; what inherits is the
finished colour. `--bg: var(--paper)` on `:root` therefore computes to the light
paper and keeps it, no matter how many descendants redefine `--paper`.

The kitchen display's night mode shipped looking correct and painted itself
white: `data-scheme="dark"` was on the element, every primitive under it was
right, and nothing changed because `--bg`, `--surface` and `--text` had all been
resolved on `:root` before the attribute was reached. The build was clean, the
types were clean, and only opening the page showed it.

**The rule: every alias whose value mentions `var()` is declared under BOTH
`:root` and `[data-scheme='dark']`, in a block after both palettes.** That
includes the alpha tones — `--ink-dim` and `--ink-faint` reference `--ink`, which
the dark palette changes — and the whole legacy block. theme.css says so at the
block; this is the same class of bug as a `<select>` whose value is not among its
options (D-047): correct-looking, silent, and invisible to every gate.

**Two contrast values are not the design's.** `--status-positive` is one step
darker than the export's `#1F7A4D`, which is 4.43:1 on the card ground and
carries the words "Done" and "Delivered" there. And `--ink-faint` is 48%, not the
45% the dark theme used: the same alpha inverted lands at 2.96:1 on white, below
even the 3:1 bar for UI text. Both are asserted, and the test now reads the
percentages out of theme.css rather than restating them.

### D-049 · The state machine did not bend to the design
Three things the export draws do not exist behind it, and none of them were
added, because CLAUDE.md says to ask before changing a state machine.

**The kitchen's "Accept · start cooking" is one button in the design and two
here.** ACCEPTED and PREPARING are distinct states in `transitions.ts` and the
guest's tracking screen renders them differently — "we have your order" is not "a
pan is on". They share a COLUMN instead, which gets the design's three-column
board without collapsing the machine.

**There is no "Recall" from the pass.** `FLOW.READY` is `['OUT_FOR_DELIVERY',
'DELIVERED']`; READY → PREPARING is not a transition. The button would have been
a lie in the one direction that matters.

**There is no "Undo" on a decided late checkout.** Approving posts a folio line
and moves `scheduled_checkout_at`, and both are `event_log` events (#7), not
fields to put back. The decided state says what happened and stops.

**One thing was made better rather than copied.** The design's reject reasons end
in a chip labelled "Other", and the reason string is shown to the GUEST verbatim.
"Other" tells somebody nothing about their dinner. The chips are whole sentences
and "Something else" opens a free-text field.

**And one thing is deliberately absent.** The kitchen ticket shows the room
number, not the guest's name. `KitchenTicket` has never carried it, and the KDS
is the thinnest role in the product on a screen left signed in overnight in a hot
kitchen — adding names there is a data-minimisation regression, not a feature.

### D-050 · Two themes, because there are two audiences
D-048 replaced the palette product-wide and the guest PWA moved with it. That
was the call at the time and it was wrong for the guest side: the customer app
is the hotel's face, and the hotel's face is the Kesari — deep indigo, saffron,
lime plaster, Marcellus over Mukta, radii sharp enough that nobody mistakes it
for a template. The "The Kesari" design document is unambiguous about every one
of those values.

So the product carries both, and neither is a variant of the other:

| | Staff console (`:root`) | Guest app (`[data-theme='kesari']`) |
|---|---|---|
| Ground | `#F3F4F2` paper | `#101E33` indigo |
| Card | `#FFFFFF` | `#1B2B45` |
| Accent | `#0F766E` teal | `#E9A227` saffron |
| Hover | darker | lighter |
| Type | Public Sans / Red Hat Mono | Marcellus / Mukta / DM Mono |
| Radii | 6–12px | 2–4px |

A guest is being HOSTED — the screen is the hotel talking, at night, on their
own phone. A cook is being INFORMED — their screen is a tool in a bright room,
read at arm's length. They are not the same design problem and one palette
cannot be right for both.

**The scope is applied once**, by `(guest)/layout.tsx`, which also exports its
own `viewport` so the phone's browser chrome is indigo rather than paper. That
route group is the whole customer surface, so nothing else has to know.

**This is what the D-048 derived block bought.** Adding a third palette was one
block of primitives: every alias that mentions `var()` already recomputed per
scope, the legacy indigo names included. Had the aliases still been resolved on
`:root`, every one of them would have needed restating a third time.

**Two values are not the export's**, both for contrast, both asserted. The guest
`--status-positive` is `#7FA9A2` rather than `#6E9C95`, which is 4.05:1 on a
raised card and carries the teal eyebrow on most screens; and `--ink-faint` is
45% here against 48% on paper, because the same alpha inverted is not the same
perceptual step. `theme-contrast.test.ts` now runs its whole suite over BOTH
palettes rather than only the default — the guest theme is the one somebody
reads at 9:40pm in a dim room, and it was the uncovered one.

### D-051 · The room home is a grid with one button
The post-scan landing was a column of full-width cards: a hero card for dining,
then four rows with chevrons. The export is a different shape — a masthead, an
arch-topped hero that says what the kitchen is doing, a greeting, a 2×2 grid of
tiles, and one button pinned to the bottom.

The pinned button is the point. Ordering food is what this product is for, and
in the layout it replaced it was a card that scrolled away. It now says which
meal the clock is on and what the kitchen can actually do, and it stays a LINK
when the kitchen is shut — the menu, the prices and the hours are readable with
the kitchen closed (#9, never gate browsing), so it goes quiet rather than
refusing.

**The arch is drawn in CSS**, not shipped as an image: it has to work before R2
exists, and a gradient costs no request on hotel wifi. The same curve is the
dish thumbnail, the service screen's rings and the tile icons — it is the one
piece of ornament in the guest app and it is what the export is built around.

**The greeting has no name.** The export says "Good evening, Anjali" and the
stay behind the session does know who that is, but nothing on the guest side has
ever shown the occupant's name, and a sticker photographed from a corridor would
be greeted by it. The hour is the part that makes the greeting read as the hotel
talking. Adding the name is a one-line change the day somebody decides that
trade is fine.

### D-052 · A stay past checkout must refuse the sticker, not loop
Scanning a QR for a stay whose checkout had passed SUCCEEDED, and minted a guest
session whose expiry is `scheduled_checkout_at + grace` — a cookie already in
the past. The browser discarded it on arrival, `/home` found no session and
redirected back to `/r/{code}`, which scanned again. An infinite redirect loop
behind a blank white screen, on the one screen a guest reaches by pointing their
phone at a sticker.

`scanQrCode()` now refuses, with the same `QrNotUsableError` as "no active
stay" — deliberately the same error, because a scanner in a corridor must not
learn which of the two it was.

It is not an edge case. It is reached whenever a checkout has not been processed:
a front desk that went home without closing the day, a PMS import that stalled.
The local demo database sat in exactly that state for two weeks and every guest
screen was unreachable the whole time, which is how it was found — and why the
guest PWA could not be looked at during D-048.

### D-053 · `tx.execute<T>()` asserts its generic, it does not parse it
`/runner` threw in production:

```
TypeError: (a.readyAt ?? a.placedAt ?? (intermediate value)).getTime is not a function
  at Array.sort  →  runnerTickets
```

`kitchenTickets()` selects through raw SQL and typed the row as
`{ placed_at: Date | null; ready_at: Date | null; … }`, then passed those values
straight into `KitchenTicket` without wrapping them. The generic on
`tx.execute<T>()` is an ASSERTION — nothing validates it — so the compiler
believed the promise, every consumer was written against it, and the value was
in fact whatever the driver felt like returning for a `timestamptz`.

**Every other raw-SQL mapper in the codebase already wrapped.** `readRequests`,
`listCheckoutRequests`, `guest-profile`, `shifts`, the folio — all of them do
`row.x ? new Date(row.x) : null`. This one function was the outlier, and it had
been since the commit that introduced it.

**Why nothing caught it for that long.** `Array.sort` does not call its
comparator on a list of fewer than two. A property with one tray moving worked
perfectly — in dev, in every screenshot taken while the floor screens were being
rebuilt, and in the e2e suite, which walks a single order end to end. It needed
two trays on the pass at the same time, which is a normal Friday and never a
test fixture.

**The fix is the wrap, and the guard is that the pieces are now pure.**
`toKitchenTicket()` and `byRunnerPriority()` moved to `ordering/kitchen-ticket.ts`
— no database, no clock, the same reasoning as `transitions.ts` — so
`tests/unit/kitchen-ticket.test.ts` can feed the mapper the STRING shape a driver
really returns and hand the comparator two tickets rather than one. Reverting the
wrap makes those tests fail with the production error verbatim.

**The general rule, because this is not about dates.** A raw query's generic
describes what you HOPE the driver returns. Anything crossing that boundary is
`unknown` in every sense that matters, and the mapper is the only place it can be
made true. If a field needs to be a `Date`, a `number` or an array on the other
side, the mapper converts it — it does not re-declare it.

### D-054 · The amenities pill is pinned, and the screen stopped shouting
Three things were wrong with the amenities screen, and the first one made the
other two matter.

**The send button was in normal flow, at the end of the form.** The export draws
eight amenities and pins the pill to the bottom of the phone frame; we render
whatever the property has configured, which for the demo is TWENTY-TWO. So the
button sat 3,400px down a 3,451px page. A guest tapped "+" on a towel and then
had to scroll past every amenity in the hotel to find the thing that sends it,
which is the same as the button not existing. It is `position: fixed` now —
not `sticky`, because the form is the scrolling child and a sticky footer inside
it pins only within the form's own box, which ends where the content does. The
shell gained 104px of bottom padding so the note field clears it.

**The row wasted a line.** Line one was name + eta + price; line two was an
empty strip with a stepper floated into the right-hand corner. The export puts
a hint on the left of that second line, so it reads as a line rather than as a
gap. The eta moved there — it is the answer to "should I bother", it belongs
beside the control, and the row went from 134px to 112px, the page from 3,451
to 2,963.

**And it was yellow.** Every paid row drew its price as a saffron box: saffron
border, saffron tint, saffron text. Four group headings were saffron. Choosing
something filled its chip with saffron. Errors were saffron. On a list this
long the accent stopped meaning "look at this" and started meaning "background".

So: the price is plain saffron text, as the menu already draws it. The group
headings are `--plaster-faint`, because they are signposts through twenty-two
rows and not the point of the screen. "Asked for" is `--status-positive` — it
is a CONFIRMATION, and a saffron fill made an answered request look like a
caution. Errors are `--status-critical`. The only saffron left on a chosen row
is a 2px left edge, which is the one thing that actually needs finding again.

**The rule this leaves.** An accent used on every row of a long list is not an
accent. If a screen needs to mark many things at once, the marks go on the
quiet end of the palette and the accent is kept for the one element the guest
has to act on — here, the arrow on the pill.

### D-055 · The arch is SVG, and the guest app gets a 10.5px step
Two things were wrong with the room home's header, and they had the same cause:
values were being approximated from the nearest token rather than taken from
the export.

**The arch was four stacked radial-gradients**, struck from `50% 106%` — just
below the box — with a 45° hatch over the top. At the export's 358×180 that is
meant to read as nested arches rising from the foot of a doorway. At the card's
real width it produced four enormous flat circles, and with the hatch on top the
whole header looked like a record sleeve.

It is three SVG paths now: a leg, an elliptical head, a leg, on a common
springline, in three weights so the eye reads depth rather than three identical
rings. Only the innermost carries the accent — it is the doorway you are looking
through — over a radial glow at the base. Still drawn rather than photographed,
because image upload is blocked on R2 credentials and a path costs no request on
hotel wifi.

`preserveAspectRatio="none"`, deliberately. `slice` kept the aspect and cropped
the outer arch's crown clean off, because the card is wider than the viewBox.
These are abstract ellipses; letting them stretch with the card keeps the
composition whole at every width, which is what actually matters, and an 11%
horizontal stretch on a curve nobody measures is invisible.

**The card was also lighter than the page.** `--surface-raised` made the domed
top read as a lid sitting ON the screen rather than a recess cut INTO it. It is
a half-step now — `color-mix(--surface 55%, --bg)` — which is where the export's
own value sits.

**And the type had no 10.5px.** The guest app sets its mono metadata at 10.5px
in nine places — the room chip, the arch eyebrow, every tile subtitle, the
"charged to room" line, the line under the order button. The smallest token was
`--text-xs` at 12px, so all nine were rendering a size and a half too large. The
visible cost was the tiles: a two-word subtitle wrapped inside 108px and pushed
the title off its baseline, so no two tiles in the grid were the same height.

`--text-2xs: 0.65625rem` exists now, and all four tiles measure exactly 108px at
360, 390 and 430 — which is the export's number.

**The lesson is the one D-048 already taught in a different key.** A scale is
not a suggestion: when a design sets a size the token set does not have, adding
the step is the fix. Rounding to the nearest token is how a layout ends up with
four cards of three different heights and nobody able to say why.

### D-056 · A guest can reach an order after they stop looking at it
`placeOrder()` redirected to the tracking screen. That screen's back button went
to the room home. Nothing on the room home led to an order. So the moment a
guest pressed back — or locked their phone, or scanned the sticker again an hour
later — the thing they had just paid for became unreachable, and everything they
had ordered earlier in the stay had never been reachable at all.

The folio on `/stay` lists the charges, but that is a bill, not an order: it
cannot tell you the kitchen has your dinner, and it is behind the verification
prompt.

**Three pieces.**

`listOrdersForStay()` is a summary read, not `getOrderForStay()` in a loop. That
one assembles a receipt — every line, every modifier, three queries per order. A
list wants one line of prose and a total, so this reads the items in a single
pass and never touches `order_item_modifiers`: a stay with fifteen orders is two
queries rather than forty-five. DRAFT is excluded, because a DRAFT is the cart.

`/r/[qrCode]/orders` is the screen. "Happening now" over "Earlier in this stay",
every row a link to the timeline it already had — including refused ones, since
a guest whose dinner was refused is the person most likely to want to read the
kitchen's words again.

The room home grew a strip between the greeting and the tiles, and only when
there is something to reach. With exactly one order moving it goes straight to
that order's timeline — one tap to the thing they want; with several, or with
none moving and some history, it goes to the list. Above the tiles rather than
among them, because the tiles are four doors and this is news — and because a
fifth tile would have made the export's 2×2 a 2×3 with a hole in it.

**The stream's `orderId` became optional.** The tracking screen watches one
order; the list watches the stay. What makes that safe is that `orderId` was
never the boundary — `stayId` is (#10), it comes from the session rather than
the query, and it is checked on every notification either way. Dropping the
narrowing widens what a guest hears about their OWN stay and nothing else.

**And the vocabulary moved into `track.ts`.** That file's header already said it
is "the one place a status the machine can reach might have no step to stand
on". The list added a second place with exactly that shape, so `orderStateFor()`
lives beside `trackView()` and `track.test.ts` holds both to the same standard:
every member of `ORDER_STATUSES` has a line, no line leaks the enum's own
spelling at a guest, and `stopped` is reserved for the two statuses where
something asked for is not coming.

**Why `/orders` is not gated.** #9 puts the one prompt at the first attempt to
CHARGE, which already happened when these orders were placed. Asking again to
look at them would be asking twice for the same thing.

**DISPUTED is history, not "happening now".** Its tone is open — the hotel is
still doing something — but the dinner arrived, possibly days ago, and what is
open is the money. It belongs beside the order it is about.

### D-057 · The cart is reachable from the screen that fills it
Adding a dish left a guest on the dish screen with a line of text saying it had
worked and no way to see what they had built. The only route to the cart was the
pill at the foot of the MENU — so the answer to "what have I ordered so far",
asked on the screen where it occurs to you, was two navigations away.

The dish screen now carries the same control: count, "Review order", total,
arrow — the menu pill's own order, because it is the same control in a different
place and should not have to be re-learned.

**It goes INSIDE the pinned bar, above the Add button**, not floating beside it.
That bar is already fixed to the bottom 40% where a thumb reaches, and two
pinned bars at a thumb is how the wrong one gets tapped. It is styled quietly on
purpose: on a dish screen the primary action is still adding the dish, and the
review row is the escape hatch for somebody who has stopped browsing.

**The cart is read in the same transaction as the dish**, priced at the same
property-local time. The menu already did this for its pill, and for the same
reason: a dish outside its schedule has to total as unavailable in both places,
or the bar disagrees with the price printed above it.

**`addToOrder` revalidates the dish route as well as the menu.** It only
revalidated `/menu` before, which was right when the dish screen showed nothing
about the cart and is wrong now — the count and total move the moment the dish
is added. The route PATTERN is revalidated rather than a built path, because
`itemId` is not in the action's input; `revalidatePath('/r/[qrCode]/menu/[itemId]',
'page')` is the same form the checkout action already uses for
`/r/[qrCode]/stay`.

**The export does not draw this.** Its dish screen has "How many" and "Add to
order" and nothing else — a static mock never has to answer the question. This
is a product decision on top of the design, in the design's own language.

### D-060 · The console streams, and opens on work
Three things were wrong with the ops console, and they had one cause: it was
built as a set of pages to be read, not as a screen to be left open.

**It did not stream.** The kitchen display, the runner queue and the floor board
have all had `useLiveRefresh` since P1. The console never did — so the one
screen a front desk leaves open all shift was the one screen that lied. A guest
orders dinner, the kitchen accepts it, a housekeeper picks up a towel request,
and the desk showed none of it until somebody pressed reload. A desk that has to
reload to be right is a desk that stops trusting the numbers.

Both staff streams already existed and already authorised on the right
permission, so this needed no new API: `LiveConsole` subscribes to
`/api/kds/stream` and `/api/requests/stream` and lets whichever fires first call
`router.refresh()`. The screen never learns WHICH kind of thing moved — it
re-reads the server-rendered page, which is the same discipline every other live
surface follows.

Both feeds are opt-in per permission, and the indicator reports what it is
actually hearing. A desk without `order:read` subscribes to requests alone and
says so, rather than claiming a feed it does not have. `useLiveRefresh` now
takes `streamUrl: string | null` for exactly this: a hook cannot be called
conditionally, so the decision has to be expressible as a value.

**It opened on thirty empty rooms.** The desk defaulted to All, which at this
property is 001–104 before the four rooms with anything happening in them. A
front desk does not come to this screen to read the vacant list; they come
because a phone rang. The default is `Needs you` — rooms with an open order, an
open request, or a decision waiting — and because a filter that can legitimately
be empty has to offer the way out of itself, its empty state says "the floor is
quiet" and links to every room.

**The folio pushed its own total off the screen.** The panel rendered every line
a stay had accrued; four nights of dinners ran past the fold, and the number a
desk is asked for on the phone was the one thing they had to scroll for. Twelve
most recent, newest first, with the count of what is hidden said out loud so the
total can never read as the sum of what is on screen, and a link to the guest
profile where reading a whole bill is the point.

### D-061 · One screen, one job — the property switch
`/admin/property` was a single 4,400px page holding four unrelated jobs: the
hotel's name and clock, its room types, its floors, and all thirty-four of its
rooms. Adding a room meant scrolling past every existing one, and the currency
field — write-once, and the most consequential control on the screen — sat at
the top of a page nobody scrolled back up.

It is three tabs now: This hotel, Room types, Floors & rooms. The first two are
900px; the third is long because thirty-four rooms are long, but it is at least
only that.

The switch is `?tab=`, rendered as LINKS, which is the same control the front
desk already uses for Rooms/Requests/Orders. Two consequences, both deliberate:
the choice survives a reload and can be sent to somebody, which client state
cannot; and the styling moved out of `desk.module.css` into the shared console
stylesheet, because a console with two different-looking ways to switch between
views of one screen is a console you have to learn twice.

### D-062 · The website is the front door, and `/demo` is its threshold
`/` was a placeholder that read "Hotel guest services platform". It is the
marketing site now — one page, four anchors, built from `Innstant Website.dc.html`.

**Nothing moved.** Guests still enter at `/r/[qrCode]`, staff at `/admin`, the
floor at `/kds` and `/runner`. The site was added beside them, in a `(site)`
route group with its own theme scope and its own layout. That was a choice
between two readings of "the website is the home page"; the other one — moving
the app under `/app` or `/admin` — would have rewritten every QR sticker that
has ever been printed.

**One page, not five.** The export is a five-screen app switched by `setState`,
because a design tool has no router. We have one, and using it would have meant
five routes and four more chances for the nav to disagree with the page. It is
one document with `#product`, `#themes`, `#security` and `#contact` — which is
what the content is: a single argument read top to bottom. It ships as a static
render with no client JavaScript except the form.

**Two things from the export are not on the page.** The hero's release badge
("NEW · Late checkout approvals now in the front-desk console") is gone: it
announces a feature to an audience that has never seen the product, and it was
the first line of the page. The Themes section is gone too — six palette
swatches are a claim about flexibility the site cannot back up until there is a
second live property, and a nav item pointing at six coloured rectangles
promises a page that is not there. `THEMES` stays in `content.ts`, because the
six names are still the logo strip, and the section can come back when there is
a hotel behind one of them.

**A third theme, `[data-theme='innstant']`.** Warm off-white, brand navy,
Instrument Serif over Figtree, DM Mono shared with the guest app. It is held to
the same AA bar as the other two in `theme-contrast.test.ts`, and that test
earned its place immediately: the identity's gold (`#C99A4B`) and the design
file's amber (`#C97F12`) are 3.22:1 and 2.91:1 on white. Both fail as text. The
accent token holds a darker amber; the brand gold survives as a graphic — the
dots in the monogram, the roof over the A — which is where it was always
legible.

**The logo is drawn, not linked.** `components/innstant-logo.tsx`. A raster
would need three sizes and would still be soft on a retina front desk; an SVG is
one file and one `currentColor` away from a navy header, a white page or a
favicon.

Two constructions were wrong before one was right, and the reasoning is in the
file because it is not obvious. Two tangent CIRCLES read as an S but lock the
proportion at 1.7 tall-to-wide against the artwork's ~1.4 — no stroke width
fixes it, the geometry forbids it. Unequal bowls on an offset axis widen it and
turn it into a lowercase g, because the diagonal closes the upper counter; four
variants, all g. Two tangent ELLIPSES, `rx` 33 and `ry` 27, stack twice inside a
1.4 box and still reverse curvature cleanly at the waist. The terminals are cut
at 35° and 145°, which is what keeps the counters open — wrap them further and
the g comes back.

It is a recreation traced by eye from the supplied artwork, not the artwork.
Drop the original files into `public/` and it becomes an `<img>`.

**The form does not submit, and it says so.** There is no CRM and no
`demo_requests` table. The honest options were to delete the form or to be plain
about it; deleting it loses the page's closing argument, and a form that says
"thanks, we'll be in touch" and drops it on the floor is a lie told to somebody
who was about to become a customer. The button opens a `mailto:` with everything
typed, and the note under it says why.

### D-063 · The demo visitor: a name, a vouch, and one untenanted table
"See how it works" opens the seeded property as a guest. Three things had to be
true that were not.

**A name to greet them by.** A visitor has no stay, so `session.guestFirstName`
is Anjali Menon's — a strange thing to call a stranger. `/demo` asks once, keeps
the answer in a cookie for 90 days, and the room home prefers it. It is asked
only on this path; `/r/{code}` from a sticker is untouched, and CLAUDE.md #9
stands. The screen is not a gate in #9's sense: #9 protects somebody who has
already paid for the room they are standing in, and the question here IS the
demo — the product's whole claim is that the hotel knows who is in the room.

**`demo_visitors` (migration 0007), the only table in the product with no
tenant.** A stranger on a marketing site belongs to no hotel, so `withTenant()`
would mean inventing a tenant to satisfy a signature. What the table needs
instead is an asymmetry the tenant rule cannot express — the app may INSERT and
must never SELECT — and that is enforced in Postgres: forced RLS, one INSERT
policy, no SELECT policy. Verified against the live database: the row is
written, and `app_user` counting the table it just wrote to gets zero. The guest
book is read with `psql`, by whoever owns it. `withPlatformWrite()` is the named,
logged, WRITE-only path; it is not a second escape hatch from #1.

**The four-digit prompt, skipped — by vouch, not by bypass.** A visitor has no
phone number in anybody's PMS, so the escalation at the first charge asks a
question with no answer and the demo dead-ends on the screen it exists to show.
`openDemoSession()` opens the session at FULL and writes
`guest_session.demo_opened` to `event_log` with the tier it granted. That is
D-012's own second mechanism — a vouch — and the vouch here is the demo itself.
What makes it safe is where it can be reached from: only `/demo`, only against
`DEMO_TENANT_ID`, with no parameter a visitor could point at a real hotel.
Proven on the deployment: the demo session sees the folio; a plain scan of the
same room still gets the prompt.

**The action does the whole job.** The first version ended with
`redirect('/demo/enter')` and the form silently did nothing — a Server Action's
redirect is followed by the CLIENT router, and the App Router cannot navigate to
a Route Handler. Server Actions can set cookies, which was the only reason the
handler existed; it now opens the session itself and redirects to a page.
`/demo/enter` survives for the returning visitor, reached by a server-side 307
that the browser follows before any router is involved.

### D-064 · An animation that quietly ate a `transform`
The hero's phone mock printed the logo strip's hotel names straight across its
"Order dinner to room 214" button on any screen under 720px.

The cause is worth writing down because it looks like a z-index problem and is
not one. `.heroArt` carries `fadeUp`, whose last keyframe is `transform: none`,
with `animation-fill-mode: both` — so the animation keeps filling forever, and
an animated property beats a declared one. The narrow-screen rules set
`transform: scale(0.62)` on that same element; it computed to the identity
matrix and did nothing. The phone stayed 620px tall inside a 420px box,
overflowed 200px down the page, and the logo strip drew over it.

Nothing in a build or a test catches this: the CSS is valid, the cascade is
working as specified, and the only symptom is 200 pixels of overlap on a screen
nobody had opened.

Two changes. The breakpoints RESIZE the composition now rather than scaling it —
and the tablet one turned out to need nothing at all, because a single column is
the full 1144px, which is wider than the ~580px the art gets in the two-column
layout. Below 640px the two floating cards are hidden and the phone stands alone
and centred: 640 is where it actually breaks, since the ticket is 300px at
`right: 0` against a 300px phone at `left: 0`, and at 641px that leaves five
pixels between them.

The element now carries a comment saying not to put a transform on it, because
the next person to try will have exactly as little evidence as the last one did.

### D-065 · The logo is the artwork now, not a tracing of it
Every earlier version of `components/innstant-logo.tsx` drew the mark: arcs,
circles, and the word set in Figtree with a gold chevron over the A. It was
never right and could not have been — the real lockup sets "InnSTÂNT" in mixed
case with a four-point sparkle after the T, and no amount of tuning arc radii
arrives there. The whole construction is deleted. D-062's and D-064's notes
about ellipses and terminals are now history rather than instructions.

**Two cuts, chosen explicitly.** The artwork ships light (navy ink) and dark
(white ink), and each is legible only on the ground it was drawn for. `tone`
picks. There is no automatic choice: a component cannot know what is behind it,
and guessing wrong makes the logo disappear rather than look slightly off.

**Neither original could be used as supplied.** Both arrived with OPAQUE
backgrounds — white behind one, a navy gradient behind the
other. Dropped in, each draws a rectangle: white on the site's warm `#F3F4F1`,
a lighter navy box on the `#101E33` panels. `scripts/prepare-logo.ts`
(`pnpm logo:build`) keys the background to alpha, trims to the artwork and
resizes. The masters stay in `src/app/images/` as the source of truth and are
excluded from the Docker context, because nothing imports them.

Three details in that script are worth keeping:

- **It runs in Chromium.** Decoding a PNG in Node without a dependency means
  implementing inflate plus five scanline filters. Playwright is already a
  devDependency and its canvas does decode, key, trim and re-encode in one pass.
- **A distance key is enough.** It leaves anti-aliased edges holding a blend of
  artwork and background — the classic halo — which does not matter, because
  each cut is only used on the ground it was drawn against. A white fringe on a
  near-white page is invisible; so is a navy one on navy.
- **The two need different alpha floors, 26 and 96.** The dark file's
  letterforms carry a glow drawn against its own `#191B30`; ours is `#101E33`,
  darker, so the surviving glow read as a grey smudge behind the word. The same
  floor also cuts the background noise that had made the PNG 1,023KB instead of
  89KB, because PNG compresses flat transparency and cannot compress speckle.

**Each cut's width comes from its OWN file.** The two are trimmed from
separately-exported masters and do not come out identical — 700×197 against
700×195 in the current set. A single shared ratio squashes one of them by a
percent, which is invisible until the two are seen side by side and then cannot
be unseen.

**`size` means HEIGHT now**, not the mark's width; the width follows from the
artwork's own aspect. That is what a header actually asks for, and the previous
meaning made every call site a guess.

**One trap found on the way.** The stylesheet set `height: auto` AND
`width: auto` on the image. With both, the browser ignores the width and height
attributes and uses the intrinsic 700×200 capped by `max-width` — which made
the footer lockup three times its intended size and left the nav one looking
correct only because a flex row happened to squeeze it back down. `height: auto`
alone is right: it keeps the aspect if a narrow parent forces the width below
the attribute, and otherwise defers to the attributes.
