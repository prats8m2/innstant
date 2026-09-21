# CLAUDE.md

Read this first, every session. Then read `docs/STATUS.md` — where the work
actually is, what is next, and what is blocked — and run `pnpm status`, which
re-derives that from the repo and the database rather than trusting the file.
`docs/DECISIONS.md` says why things are the way they are; `docs/PROJECT-PLAN.md`
and `docs/P0-TASKS.md` say what to build next.

**Before ending a session, update `docs/STATUS.md`.** Move the finished session
into Done with its commit, rewrite `## Now`, and append anything learned to
Environment notes. This project spans many sessions; that file is the handoff.

---

## The product

A multi-tenant hotel guest-services platform. A guest scans a QR code on their
nightstand and can order food, request amenities, call a staff member, manage
their checkout, and browse a curated list of nearby places. Hotel staff manage
all of it from an admin panel, a kitchen display, and a runner app.

Three surfaces, one codebase:
- **Guest PWA** — `/r/[qrCode]` and below. Mobile only, no install, no signup.
- **Ops console** — `/admin`. Desktop. RBAC-heavy.
- **Kitchen & floor** — `/kds`, `/runner`. Always-on tablet and phone.

Booking is deliberately **not** in scope. See `docs/EXTENSION-POINTS.md`.

## Stack

| Layer | Choice | Not |
|---|---|---|
| Framework | Next.js App Router, `output: 'standalone'` | not serverless |
| Language | TypeScript, strict | |
| DB | PostgreSQL + Drizzle ORM | not Prisma, not TypeORM |
| Validation | Zod at every boundary | |
| Styling | Tailwind + shadcn/ui with overridden tokens | not stock shadcn |
| Motion | Framer Motion | |
| Icons | lucide-react | not hand-drawn SVG |
| Realtime | Postgres `LISTEN/NOTIFY` → SSE | no Redis, no Socket.IO yet |
| Hosting | Railway (app + Postgres), Singapore region | not Vercel |
| Images | Cloudflare R2 + CDN | |
| Payments | Razorpay | |

**The app runs as a persistent Node process.** Do not write code that assumes a
serverless request lifecycle. Long-lived DB pools, SSE connections and in-process
schedulers are all fine and expected.

## Repo layout

```
src/
  app/
    (guest)/r/[qrCode]/...      guest PWA
    (admin)/admin/...           ops console
    (ops)/kds/...  (ops)/runner/...
    api/...                     route handlers (webhooks, SSE, health)
  modules/                      domain logic — the real code lives here
    identity/  stay/  catalog/  ordering/  requests/
      # identity owns tenancy: tenants, properties, floors, rooms,
      # room_qr_codes, staff_users, roles. provisionProperty() lives here.
      # There is no `tenancy` module.
    housekeeping/  concierge/  billing/  notifications/  access/
  db/
    schema/*.ts                 Drizzle tables, one file per module
    migrations/*.sql
    client.ts                   pool + withTenant()
  lib/                          cross-cutting: zod helpers, money, dates, errors
  components/                   shared UI only; feature UI lives beside its route
  styles/tokens.css             GENERATED from design/tokens — do not edit
design/                         design source of truth — see design/README.md
docs/
```

Each `modules/<name>/` owns its tables and exposes a service interface.
**A module's tables are only importable from that module.** Enforced by an ESLint
`no-restricted-imports` rule — if you need data from another module, call its
service function.

## Commands

```bash
pnpm status           # where the work is + verified env state — run first
pnpm dev              # next dev
pnpm dev:lan          # next dev + APP_URL set to this machine's wifi address,
                      #   so a QR link opened on a phone reaches this laptop
pnpm build            # next build (standalone)
pnpm typecheck        # tsc --noEmit
pnpm lint
pnpm test             # vitest — unit
pnpm test:integration # vitest against a real Postgres (D-024)
pnpm test:e2e         # playwright

pnpm db:generate      # drizzle-kit generate from schema/*.ts
pnpm db:bootstrap     # create app_user on a fresh database (CI, or a local PG)
pnpm db:migrate       # apply migrations (runs as the migration role, not app_user)
pnpm db:studio
pnpm demo:reset       # wipe + reseed The Kesari demo property
```

---

## Non-negotiables

These are invariants, not preferences. If a task seems to require breaking one,
stop and ask instead of working around it.

### 1. Every database access goes through `withTenant()`

```ts
await withTenant({ tenantId, propertyId }, async (tx) => { ... });
```

It opens a transaction and sets `app.tenant_id` / `app.property_id`, which the
RLS policies read. A raw `db.select()` outside this helper returns nothing at
best and leaks across hotels at worst. There is no legitimate exception in
request-handling code.

### 2. The app connects as `app_user`

`app_user` owns no tables and lacks `BYPASSRLS`. Migrations run as a different
role. If you ever find RLS "not working", check which role is connected before
changing a policy.

### 3. Never issue a bare `SET` — always `set_config(..., true)` inside a transaction

**Superseded in part by D-022: there is no PgBouncer.** The app connects
directly to Postgres, and the connection pool is node-postgres inside our own
process.

The rule itself is unchanged and still load-bearing. Our pool reuses
connections across requests, so a session-scoped `SET` leaks from one guest's
request into the next one that picks up that connection — a cross-tenant leak
with no error attached. `set_config(..., true)` is transaction-scoped and
cannot. `withTenant()` is the only place this is done.

Keeping the discipline also means a pooler can be put back later without
touching a line of application code.

### 4. Stays are created in exactly one place

`modules/stay/createStay()`. Front desk, PMS import and the seeder all call it.
Nothing else inserts into `stays`. This is what keeps a future booking module
additive.

### 5. Money is integer minor units

`*_minor` columns, plus a `currency` on every row holding an amount. No floats,
no decimal strings, no implicit currency. Format with tabular figures and Indian
digit grouping (₹1,150 — not ₹1150, not ₹1.15k).

### 6. Snapshot every transactional line

`order_items` stores `name_snapshot` and `unit_price_minor`. The FK to
`menu_items` is `ON DELETE SET NULL` and exists for analytics only. Renaming a
dish must never alter a past receipt. Same for `service_request_items`.

### 7. Every status change writes an `event_log` row in the same transaction

Not after. Not in a hook that might fail independently. `event_log` has UPDATE
and DELETE revoked — it is the audit trail, the SLA analytics source, and the
dispute record.

### 8. Idempotency on every money path

Order placement, payment capture, PMS posting. Use the `idempotency_keys` table.
A guest double-tapping "Place order" on hotel wifi is the most common duplicate
in this product, and it is not hypothetical.

### 9. Never gate browsing behind verification

A bare QR scan grants the tier in `access_policies.base_tier` (default
`REQUEST`). The one verification prompt appears only at
`access_policies.escalation_trigger` — by default, the first attempt to charge
to the room. Menus, prices, POIs and free service calls must work with zero
screens in the way. See `modules/access/`.

### 10. Guest sessions bind to `stay_id`, never `room_id`

Rooms are reused. A session keyed on a room shows the previous occupant's data.
Session tokens are stored as SHA-256 hashes only, and are revoked at checkout.

### 11. Never put a price on `rooms`

Prices belong to a rate plan for a room type on a date. Adding `rooms.rate`
"just for display" silently commits the model to per-room pricing.

### 12. Reserved names — do not use for anything else

`bookings`, `booking_rooms`, `rate_plans`, `rate_calendar`, `inventory_days`,
`cancellation_policies`, `promotions`, `add_on_products`.

---

## Conventions

**Server Actions** for mutations originating in our own UI. **Route Handlers**
for webhooks, SSE, health checks, and anything a third party calls.

**Zod at every boundary.** Parse the input at the edge of a server action or
route handler, then pass typed data inward. Domain services accept parsed types,
never `unknown` or `FormData`.

**Errors are typed and thrown, not returned as `{ error }` tuples.** Map to HTTP
status in one place. Guest-facing messages say what happened and what to do; they
do not apologise and are never vague.

**Dates** are stored as `timestamptz`. Anything a human sees is rendered in the
property's timezone (`properties.timezone`), never the server's. Availability
windows and business-day rollovers are property-local.

**Tests:** every state machine transition and every money calculation needs a
unit test. Concurrency paths (idempotency, one-active-stay-per-room) need a test
that runs two operations in parallel and asserts exactly one wins.

**UI:** mobile-first for guest routes, 44px minimum touch targets, visible focus
states, `prefers-reduced-motion` respected.

**Use a library for a solved problem.** Icons, date maths, currency
formatting, slugs, colour manipulation, virtual lists, drag and drop — if it is
a well-trodden problem with a maintained, tree-shakeable package, take the
package. Hand-rolling these is not craft; it is an unbudgeted maintenance
commitment that nothing tests and nobody reviews against a spec.

This was learnt the expensive way on icons. The guest tiles went through a CSS
arch repeated four times, then four hand-written SVG paths — the first of which
read as a list icon on a screen made of lists — before landing on `lucide-react`
(D-073). Two rounds of work, and the third answer was an import.

The bar to clear is the one already stated below: **ask before adding a
dependency over ~50KB**, judged on SHIPPED bytes, not installed size. Lucide is
2,095 icons on disk and about a kilobyte in the bundle for the handful actually
imported.

The exception is anything that encodes a decision this product has opinions
about. `withTenant()`, the money type, the access tiers and the state machines
are deliberately ours, because a library would have to be bent to the
non-negotiables above and the bending is the hard part. Illustration is also
not iconography: the jharokha arch on the guest home is drawn by hand because
it is the brand, and no package has it.

**CSS custom properties are the only source of colour, radius, type, and motion
values.** They live in `src/styles/theme.css`, hand-maintained. Never hardcode a
hex, a radius, or a duration in a component — use `var(--saffron)`, not
`#E9A227`. This is what keeps a second hotel a palette swap rather than a
layout fork (D-016), and `properties.branding` sets the same variables at
runtime.

There is no token build pipeline — no `tokens.json`, no `pnpm tokens:build`
(D-023, superseding the generator half of D-016).

`design/reference/kesari-guest-app.html` is the design reference. It is a
compiled bundle; run `pnpm design:decode` to read it, and
`design/reference/DESIGN-SPEC.md` for the extracted palette, type, shape and
motion values. **Match the reference — but rebuild it with real components; do
not paste its markup.** When the reference and `theme.css` disagree, the
reference wins and `theme.css` gets fixed.

---

## Working style

- Read the relevant `docs/` file before starting a task. `DATA-MODEL.md` explains
  the schema's reasoning; the schema files themselves are heavily commented.
- Small commits, one concern each. Conventional commit messages.
- Run `pnpm typecheck && pnpm lint && pnpm test` before saying a task is done.
- If a task requires a schema change, write the Drizzle change and the migration
  together, and update `docs/DATA-MODEL.md` in the same commit.
- If you disagree with an instruction here, say so. Do not silently work around it.

**Ask before:** changing the tenancy model, adding a new external service,
adding a dependency over ~50KB, changing an existing state machine, or anything
in `docs/EXTENSION-POINTS.md`.

**Definition of done for a task:** types pass, lint passes, tests pass, the
happy path works against the seeded demo property, and the event log shows the
transitions you expect.
