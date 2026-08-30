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
