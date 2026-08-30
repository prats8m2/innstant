# Status

**Read this after `CLAUDE.md`, at the start of every session.** It is the
handoff between sessions — where the work is, what is next, and what is
blocked.

Run **`pnpm status`** first. This file states intent; that command states
verified fact (which commit, whether the gates pass, whether the database is
reachable and correctly configured). If the two disagree, the command is right
and this file is stale — fix it.

**Keep this current.** At the end of a session: move the finished session into
Done, rewrite the Now section, and append anything learned to Environment
notes. A stale status file is worse than none.

> Editing note: do not locate this file's Now heading by searching for the
> literal string with backticks — that phrase appears in this paragraph too,
> and splicing on it eats the heading. Match a line that is exactly `## Now`.

---

## Now

**P0 is done. P1 · in-room dining is in progress.** Four of the six guest
ordering steps are built and green.

Done so far in P1:

- **The menu** — `/r/[qrCode]/menu`. Editorial sections, sticky rail, scroll spy.
- **Modifier groups** — four reusable groups seeded for The Kesari. "Chilli" is
  one row shared by seven dishes.
- **The cart** — `ordering`'s first tables. One per `(stay, outlet)`, live
  prices rather than snapshots, `calculateTotals()` pure and separately tested.
- **The dish screen** — `/r/[qrCode]/menu/[itemId]`. Modifiers, quantity, note,
  and an "Add to order" button whose total moves as you choose. It writes a real
  cart row; verified end to end against the built standalone server.
- **The cart** — the pill on the menu and `/r/[qrCode]/cart`, a real route drawn
  as the reference's bottom sheet. Edit quantities, remove a line, see the
  totals. Works with JavaScript off.
- **`createStay()`** — CLAUDE.md #4 is now enforced rather than asserted. The
  seeder and both integration suites go through it.
- **Placement** — `placeOrder()`. Snapshotted (#6), idempotent under a real
  double-tap (#8), `event_log` in the same transaction (#7), folio line posted.
  `billing` gets its first service.
- **The confirmation** — `/r/[qrCode]/order/[orderId]`, read entirely from the
  order's snapshots.

**The guest ordering path is complete end to end**: scan → browse → dish →
cart → send → placed, charged to the room. Verified on the built standalone
server, not just in tests: KE-1186 at ₹1,953, the folio balance recomputed by
its trigger, one `order.placed` event with actor GUEST.

**Next, in `docs/PROJECT-PLAN.md` P1 order:**

1. **Access escalation on the first charge** — the one verification prompt, and
   the last piece of D-012 that is designed but not wired. `modules/access` has
   `requireTier`, `startPhoneLast4Challenge` and the escalation flow from S7;
   `placeOrder()` does not consult any of it yet, so a bare REQUEST-tier scan
   can currently charge the room. That is the next thing to fix.
2. **KDS + SSE** — `LISTEN/NOTIFY` fan-out, the ticket rail, the order state
   machine beyond PLACED. Nothing yet moves an order out of PLACED.
3. **Order tracking** — the `track` screen in the reference, once SSE exists.

**One gap worth naming:** `modules/stay/createStay()` does not exist. CLAUDE.md
#4 says every stay is created there and nothing else inserts into `stays` — and
right now the seeder and both integration suites insert directly. That has to
land before the folio work in step 2, which is the first thing that really cares
which stay a charge belongs to.

**Still not deployed.** P0 shipped the Dockerfile, `railway.json` and the CI
workflow, all verified locally, but this repo has no git remote and there is no
Railway app service. `pnpm status` reports both under DEPLOY, and
`docs/DEPLOYMENT.md` has the steps. That is an account-holder task.

## Done

| Session | Commit | What landed |
|---|---|---|
| P1 | `2006880` | Send the order and the confirmation screen. Idempotency key minted at render so a double-tap carries one key. Promise time in the property's timezone. |
| P1 | `4d14eef` | `placeOrder()` — snapshots, idempotency, event log and folio line in one transaction. `billing`'s first service. |
| P1 | `525b220` | `createStay()` — #4 enforced rather than asserted; `identity` gains findRoomAtProperty(). |
| P1 | `f55118b` | The cart: pill on the menu, `/r/[qrCode]/cart` as the reference's sheet, edit and remove without JavaScript. `NEXT_DIST_DIR` added so a build stops breaking a running dev server. |
| P1 | `4243149` | The dish screen: modifiers as real radios, quantity, note, and an Add to order whose total moves live. Fixed a non-idempotent `bundle:static` that served a CSS-less page on any rebuild. |
| P1 | `25aba20` | The server-side cart, keyed to the stay (#10). `calculateTotals()` pure and unit-tested; live prices, not snapshots; selections re-validated server-side. |
| P1 | `7e22932` | Modifier groups — four reusable ones seeded, `getDish()` reads a dish with its groups in one join. |
| P1 | `f2b4331` | The guest menu: `getInRoomDiningMenu()`, editorial sections, sticky rail with a scroll spy. Fixed a seeded collection that was silently empty, and an e2e suite that had been asserting S1 behaviour since S7. |
| S8 | `c370d9a` | GitHub Actions with an ephemeral Postgres (D-024). Pinned three-stage Dockerfile carrying no owner credentials (D-025). `/api/health` reports migration drift by name. Pino + `x-request-id`. Pool drained on SIGTERM. e2e rewritten against the seeded property. |
| — | `9fba2a4` | Docs reconciled with filesystem. DATA-MODEL §3 rewritten to match D-012. `modules/tenancy` → `modules/identity`. P0 split into 10 sessions (added S2a, S3a). git init. |
| S1 | `57be712` | Next.js App Router scaffold, TS strict, `output: 'standalone'`. Route groups, `/api/health`. Module-boundary ESLint rule + 7 probe tests. `src/lib/money.ts` + 20 tests. Vitest + Playwright. Node pinned to 22. |
| — | `48dd194` | `docs/STATUS.md` + `pnpm status` — the cross-session resume mechanism. |
| S2 | `2dfb937` | `theme.css` from the decoded export, three self-hosted OFL fonts, room home rebuilt as real components. WCAG + no-hardcoded-value tests. No token pipeline (D-023). |
| S7 | `7ff122e` | `/r/[code]` link → session with no verification screen. Access tiers, escalation-not-403, PHONE_LAST4 with per-room rate limiting, staff vouching, revocation at checkout. SECURITY DEFINER routing lookup (0003). |
| S6 | `869b73c` | `provisionProperty()` as one transaction across four modules via their service interfaces. 23 request types, D-012 access policy, QR at v1, first PROPERTY_ADMIN. `pnpm demo:reset` seeds The Kesari. Integration fixtures rewritten to use real provisioning. |
| S5 | `2adb1fa` | Argon2id, SHA-256 session tokens, `authorize()` in one place, 8 seeded roles, typed errors mapped to HTTP once, edge-safe middleware. 403 at your property / 404 at another. |
| S4 | `a667728` | 26 integration tests: cross-tenant reads, the unscoped case, WITH CHECK on INSERT and UPDATE, context non-leakage across pooled connections, event_log append-only, D-007 under real concurrency, and app_user's inability to dismantle its own constraints. |
| S3b | `61997df` | `withTenant()` + typed `Tx`, `recordEvent(tx, …)`, `src/db/index.ts` public surface. Pool kept unexported; second-pool lint rule. Health endpoint reports real DB state. |
| S3a | `6831aa5` | 51 tables across 11 schema files, `0000`/`0001_rls`/`0002_constraints`, migration runner. Applied to Railway. Decisions recorded as D-019, D-020. |

---

## Blocked / open questions

- **Fonts are not chosen or licensed.** `design/fonts/` is empty. A hotel
  deployment is commercial use — the licence has to be checked and the LICENCE
  file committed next to each `.woff2`. Blocks the end of S2b.
- **No pilot property identified.** PROJECT-PLAN optimises for the P1 demo,
  which is right, but if a real hotel is already interested, the four
  objection-killers in P5 (CSV menu import, QR print sheets, WhatsApp alerts,
  daily digest) should be pulled forward. Product decision, not a code one.

---

## Demo credentials (seeded, never real — D-018)

`pnpm demo:reset` wipes and reseeds The Kesari and prints these. Password for
every staff account is `kesari-demo-2026`.

| Role | Email |
|---|---|
| PROPERTY_ADMIN | gm@thekesari.example |
| FRONT_DESK | frontdesk@thekesari.example |
| F_AND_B_MANAGER | fnb@thekesari.example |
| KITCHEN | kitchen@thekesari.example |
| RUNNER | runner@thekesari.example |
| HOUSEKEEPING | housekeeping@thekesari.example |

Demo tenant id is fixed at `deadbeef-0000-4000-8000-000000000001` so it is
identifiable in a shared database. QR codes are regenerated on every reset —
re-read them from the seeder output, never cache one.

---

## Environment notes

Things that cost time to rediscover.

- **Node 22 is required.** The machine's default is Node 18, which pnpm 11
  refuses to run. `nvm use` reads `.nvmrc`. Node 18 is also past EOL.
- **Local `psql` is 14 and hangs silently against the Railway PG 18 server** —
  it connects at TCP level and never returns, with no error. This is a client
  problem, not a database problem. Use the `pg` driver (or `pnpm status`) to
  test connectivity, not `psql`.
- **SSL is required** on the Railway connection. The `pg` client needs
  `ssl: { rejectUnauthorized: false }` against the public proxy host.
- **Two database roles, verified:** `app_user` (app, no SUPERUSER, no
  BYPASSRLS, owns nothing) and `postgres` (owner, migrations only). This is
  CLAUDE.md #2 and it is what makes RLS real rather than decorative. `pnpm
  status` re-checks it every run.
- **WebKit segfaults locally on this macOS setup.** The Playwright `guest-ios`
  project is therefore gated behind `CI` or `PW_WEBKIT=1`. It must run in CI —
  guests are iPhone-heavy and this is a mobile web app.
- **ESLint flat config resolves a rule to the LAST matching block.** The
  module-boundary rule depends on this; get the order wrong and a module
  silently loses the ability to import its own tables, which lints clean and
  looks correct until real code exists. `tests/unit/lint-boundary.test.ts`
  guards it.
- **Railway public proxy hosts (`*.proxy.rlwy.net`) use a RANDOM HIGH PORT**,
  not the service's internal port. `nozomi.proxy.rlwy.net:5432` is closed;
  `:57355` is open and maps to Postgres's internal 5432. The `5432` shown in
  the Railway UI is the internal port, correct only for `*.railway.internal`
  hosts (which are unreachable from a laptop). Each service that needs external
  access gets its own TCP Proxy entry with its own generated port.
- **The design export IS readable** — `pnpm design:decode` unpacks it (gzipped
  base64 in a `__bundler/manifest` block, markup in `__bundler/template` as
  concatenated JSON string literals). An earlier pass wrongly concluded there
  was "nothing to extract"; the whole stylesheet, all 8 screens and 18 woff2
  fonts were sitting there compressed. Extracted values are in
  `design/reference/DESIGN-SPEC.md`.
- **`next start` does not work with `output: 'standalone'`**, and standalone
  does NOT copy static assets. `pnpm build` now runs `bundle:static` to copy
  `.next/static` and `public` into `.next/standalone`, and `pnpm start` runs
  `node .next/standalone/server.js`. Without this the app serves HTML with no
  CSS — which is exactly what it did for one confusing debugging round, and
  would have done on Railway.
- **Redirects use a RELATIVE Location.** Standalone binds 0.0.0.0, so building
  an absolute URL from `request.url` or `nextUrl` sends the guest to the bind
  address — behind Railway's proxy, an internal hostname. A relative Location
  is resolved by the browser against the URL it actually requested.
- **`--ink-300` is a border colour, never text** (2.39:1 on the card surface).
  Muted text is `--plaster` at 62%. `tests/unit/theme-contrast.test.ts` asserts
  every pairing — this already caught one real accessibility bug that is
  invisible on a good screen with good eyes.
- **`/r/[code]` is a Route Handler, not a page.** It must set a cookie, and a
  Server Component cannot. Without the redirect hop to `/r/[code]/home`, every
  reload minted a new `guest_sessions` row, which makes `access_escalations`
  unreadable and re-prompts a verified guest after each refresh.
- **The one deliberately unscoped query is `resolve_qr_routing()`** (migration
  0003) — a SECURITY DEFINER function returning routing ids only. A guest
  arriving at a link has no tenant, and `app_user` under RLS with no
  `app.tenant_id` correctly returns zero rows, so without it a scan could never
  resolve at all. Do not widen what it returns.
- **Integration fixtures suspend FK triggers** (`session_replication_role =
  replica`, owner only) rather than maintaining a children-first delete list.
  Hand-ordering deletes across 51 tables broke twice, in unrelated tests.
- **Integration tests run against REMOTE Railway**, so a single test can make
  dozens of round trips. `testTimeout` is 90s and `hookTimeout` 180s for that
  reason — a failure there is usually latency, not a defect. Check before
  debugging logic.
- **Provisioning is batched, and must stay batched.** Per-row round trips made
  `provisionProperty()` O(rooms) network calls — 34 rooms took ~2.5 minutes from
  a laptop, and a 200-room hotel would have taken fifteen. Rooms, QR codes,
  request types and role permissions are all bulk inserts now. Onboarding is a
  sales moment; if you add a per-row loop there, you will not notice locally and
  it will be very obvious on a real property.
- **Integration fixtures call `provisionProperty()`**, not hand-rolled inserts.
  A change that breaks provisioning now breaks the test suite, which is the
  point. `cleanup()` in tests/integration/setup.ts must track what provisioning
  creates — a stale entry there surfaces as an FK error in an unrelated test.
- **Room 214 must exist.** The design reference, the seeded stay and every
  screenshot are built around Anjali Menon in room 214. `KESARI_ROOMS` has an
  uneven floor distribution (6/12/14/2 = 34) specifically so 214 is real.
- The design export is a **compiled** Claude Design bundle with zero CSS custom
  properties. Tokens must be read off the rendered page, not grepped out.
- **`set_config(..., true)` reverts to the EMPTY STRING after commit, not to
  unset.** So `current_setting('app.tenant_id', true)::uuid` raises 22P02 and a
  query outside `withTenant()` fails with a cast error instead of returning
  zero rows. Every policy wraps it in `nullif(..., '')` — see D-020. This cost
  a debugging cycle and would have shipped as an intermittent 500.
- **Verified by hand against the live database (not yet tests — that is S4):**
  cross-tenant reads return only the caller's rows; a query with no tenant
  context returns 0 rows without erroring; `WITH CHECK` rejects an INSERT
  stamped with another tenant's id; `SET LOCAL` does not leak to the next
  transaction; `event_log` UPDATE/DELETE are revoked from `app_user`;
  `app_user` cannot disable RLS; and two concurrent `CHECKED_IN` stays on one
  room resolve to exactly one winner (D-007).

- **The e2e suite runs fully parallel against ONE database.** Each test that
  touches a cart uses its own room — 214 for the dish screen, 105 for the cart,
  301 for placement — because a cart is keyed to the stay (#10). Two tests
  sharing a room share a cart, and the failure surfaces as a wrong total
  somewhere unrelated.
- **A total appears twice on the cart screen** — once in the totals list and
  once on the send button. `getByText('₹2,415')` matches both and fails as a
  strict-mode violation, which Playwright reports as "waiting for", so it reads
  like the value never appeared. Scope to `page.locator('dl')`.
- **`pkill -f "standalone/server.js"` does NOT match the running server.** It
  renames its process to `next-server (v15.5.24)`, so the pattern misses, the
  old process keeps the port, the new one dies on EADDRINUSE, and you spend a
  while testing a build from twenty minutes ago. Kill by port:
  `lsof -ti :3000 | xargs kill -9`.
- **Build somewhere else when a dev server is running.**
  `NEXT_DIST_DIR=.next-e2e PORT=3200 pnpm test:e2e` — both are wired through
  next.config.ts and playwright.config.ts now. This replaces the note below
  rather than restating it: the collision is fixable, not just avoidable.
- **Kill the standalone server before `pnpm build`.** A running
  `node .next/standalone/server.js` holding files while `next build` writes over
  them leaves `.next` in a state where the next build fails with
  `PageNotFoundError: Cannot find module for page: /admin`. It is not a code
  error and no amount of reading the diff finds it — `rm -rf .next` and rebuild.
- **Never pipe `pnpm build` to /dev/null.** A failed build leaves the previous
  `.next/standalone` in place, so the server still starts and serves a stale or
  broken page. One CSS-less screenshot was chased for a while before the
  swallowed build error turned up.
- **A guest page that reads the database takes ~3.6s from a laptop and ~0.5s
  in CI.** The menu render is about nine round trips (BEGIN, two `set_config`,
  five SELECTs, COMMIT) and each one is ~350ms to Railway Singapore. In
  production the app and Postgres are in the same region and this is
  milliseconds — but it makes local Playwright waits misleading. A click that
  "does nothing" for three seconds is latency, not a broken navigation; that
  cost most of a debugging session before the timing was measured. Give
  navigation assertions a generous timeout locally.
- **A dish appears in more than one section on purpose.** Laal maas is in both
  "From the rooftop" and "Chef Bhairav's table", exactly as the reference draws
  it. So `getByText` on a price matches twice — use `.first()`, do not
  "fix" the duplication.
- **Run the integration suite against a LOCAL Postgres.** It is roughly twenty
  times faster (6s vs minutes), it cannot wipe a database someone is demoing on,
  and it is exactly what CI does:
  ```
  docker run -d --name pg -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
    -e POSTGRES_DB=guest_services -p 55432:5432 postgres:18
  export DATABASE_URL=postgres://app_user:app_user@localhost:55432/guest_services
  export DATABASE_MIGRATION_URL=postgres://postgres:postgres@localhost:55432/guest_services
  pnpm db:bootstrap && pnpm db:migrate && pnpm demo:reset && pnpm test:integration
  ```
- **`pnpm test:integration` used to need the env exported by hand** and failed
  with "DATABASE_URL is not set" for anyone who had not. `vitest.integration.config.ts`
  now calls `process.loadEnvFile('.env')` when the file exists; Vitest forks its
  workers from that process, so they inherit it.
- **TLS is decided from the host now** (`src/db/ssl.ts`), not hardcoded. A
  remote host gets TLS with verification off; localhost gets none. Reaching a
  local Postgres from inside a container means `host.docker.internal`, which is
  *not* local by that rule — add `?sslmode=disable` or it fails with an
  unhelpful connection reset.
- **A `DO $$ … $$` block cannot take bind parameters.** `db:bootstrap` was
  written that way first and failed with an opaque `exec_bind_message` error.
  Use `client.escapeIdentifier()` / `client.escapeLiteral()` for DDL that cannot
  be parameterised.
- **`src/instrumentation.ts` is compiled for BOTH runtimes.** An early
  `return` on `NEXT_RUNTIME !== 'nodejs'` does not stop webpack following an
  `@/db` import to `pg` to `node:fs`, and the edge build fails. The real work
  has to sit behind `if (NEXT_RUNTIME === 'nodejs') { await import(…) }` so the
  branch can be dropped. `tests/unit/edge-safety.test.ts` guards it.
- **What a build expects is baked in, not read at runtime.** `output: 'standalone'`
  ships neither `package.json` nor `src/db/migrations`, so `/api/health` would
  have reported "0 migrations expected" in production while working perfectly
  from the repo root. `next.config.ts` reads both at build time into
  `APP_VERSION` / `APP_MIGRATIONS`.
- **The e2e suite had been asserting S1 behaviour since S7 landed** — it fetched
  `/r/demo-code` and expected the code in the body, which is now a bare 404.
  Nothing caught it because nothing ran it. It now reads `.demo-seed.json`,
  written by `pnpm demo:reset`.
- **WebKit still segfaults locally, reconfirmed.** The API-request tests pass
  (no browser launches); anything that opens a page dies. CI on Linux is the
  only place iOS Safari is actually exercised.

---

## How to resume in a new session

Paste this:

> Read `CLAUDE.md`, `docs/STATUS.md`, and `docs/DECISIONS.md`. Then run
> `pnpm status`. We are on P0. Pick up at the session named in `## Now` and
> follow its prompt in `docs/P0-TASKS.md` exactly — including its stated done
> condition. Do not start the next session until that condition holds.
