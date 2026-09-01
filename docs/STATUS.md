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

**P0 is done. P1 · in-room dining is feature-complete on the guest side.** A
guest can scan, browse, order with modifiers, answer the one prompt, and watch
the order move on a live timeline; a kitchen can work the ticket.

Done so far in P1:

- **The menu** — `/r/[qrCode]/menu`. Editorial sections, sticky rail, scroll spy.
- **Modifier groups** — four reusable groups seeded for The Kesari. "Chilli" is
  one row shared by seven dishes.
- **The cart** — `ordering`'s first tables. One per `(stay, outlet)`, live
  prices rather than snapshots, `calculateTotals()` pure and separately tested.
- **The dish screen** — `/r/[qrCode]/menu/[itemId]`. Modifiers, quantity, note,
  and an "Add to order" button whose total moves as you choose.
- **The cart screen** — the pill on the menu and `/r/[qrCode]/cart`, drawn as
  the reference's bottom sheet. Works with JavaScript off.
- **`createStay()`** — CLAUDE.md #4 is enforced rather than asserted. The seeder
  and both integration suites go through it.
- **Placement** — `placeOrder()`. Snapshotted (#6), idempotent under a real
  double-tap (#8), `event_log` in the same transaction (#7), folio line posted.
- **The one verification prompt (D-012)** — wired to the charge, and completing
  the order in the same request. `placeOrder()` refuses below CHARGE.
- **The order state machine** — `advanceOrder()`, compare-and-set, every hop in
  `event_log`, `pg_notify` inside the same transaction.
- **LISTEN/NOTIFY → SSE** — its own connection, capped-backoff reconnect,
  in-process fan-out. `/api/kds/stream`.
- **The kitchen display** — `/kds`. Live rail, accept / reject with a reason /
  bump, oldest first.
- **Staff sign-in** — `/admin/login`.
- **Order tracking** — `/r/[qrCode]/order/[orderId]`, the reference's `track`
  screen. `trackView()` maps the machine's eleven statuses onto the five steps
  a waiting guest wants; `/api/guest/order-stream` is the guest's own SSE route,
  filtered on `stay_id` and one order id (D-026). A rejection replaces the
  timeline with one sentence and the kitchen's own words.
- **The folio follows the order (D-027)** — REJECTED and CANCELLED post a
  negative `ADJUSTMENT` line in the same transaction as the status change, netted
  against what is already posted so a second attempt credits nothing. Two
  tablets rejecting one ticket produce one credit, under real concurrency.
- **The runner app** — `/runner`. Trays waiting first, oldest on the pass first,
  "Take it up" recording who is carrying it and "Handed over" marking DELIVERED.
  It is the only thing in the product that can end an order.
- **The menu editor** — `/admin/menu`, and the ops console shell around it.
  Sections and dishes in one view, a dish form with modifier groups, the 86
  switch, close-the-kitchen, and a per-dish audit trail read from `event_log`.
  A reprice logs both prices. `parseMoneyInput()` is the one place a keyboard
  becomes minor units.
- **The kitchen's hours and rates** — `/admin/outlet`. `outlet_hours` was
  written by provisioning and read by nothing while both guest screens carried
  the literal "Kitchen open until 11:30pm"; `lib/clock.ts` and
  `catalog/hours.ts` are the pure halves of fixing that, and the guest screens
  read the real rows. The guest home also reads its property's own name and
  checkout time instead of "The Kesari" and "until Thursday".
- **Editorial collections** — `/admin/menu/collections`. Name, the editorial
  line, the window, membership and running order. `collections.available_from` /
  `available_until` had the same disease as the hours — seeded 22:00–01:00 for
  "After 10pm" and ignored by the read, so it showed at breakfast. The window is
  honoured now, and `getInRoomDiningMenu()` REQUIRES property-local time rather
  than defaulting to the server's clock.
- **Option groups and their options** — `/admin/menu/options`. Signed price
  deltas behind `catalog:pricing`, the count of affected dishes on every heading,
  and a two-step archive for a group dishes carry. **The catalog is no longer
  seeder-only in any part except images.**
- **`docs/UI-WALKTHROUGH.md`** — every feature with the exact clicks, the logins,
  and a snippet for reading the folio (which has no screen until P3). Written to
  be followed by someone who did not build it; also the demo script.
- **The sweep** — `charging_blocked`, `max_attempts_per_phone`,
  `allow_staff_vouch`, `lockout_minutes` and `image_url_snapshot` were stored and
  ignored; all five are read now. It also turned up a real bug: the verification
  lockout was written and then thrown over inside the same transaction, so the
  rate limiter discarded the lockout it announced.
- **Dish schedules** — `menu_item_availability_windows`, the last of the sweep's
  stored-and-ignored tables. `isItemOnNow()` is pure and tested; the schedule
  folds into the same `isAvailable` flag every screen already reads, and
  `placeOrder()` computes property-local time itself so no caller can forget it.
  Three schedule rows on the dish form.
- **The kitchen's own tools** — a count of tickets nobody has accepted, a
  synthesised alert when that count rises, prep timers ageing against each
  ticket's own promise, and an 86 button on every line behind
  `catalog:availability` alone. **P1's Kitchen checklist is complete.**

**P1's exit criterion now runs end to end, in one automated test.** A guest
orders on a phone, a kitchen accepts and plates it, a runner on a third device
takes it up and hands it over, and the guest's timeline reaches "At your door"
and stops streaming. Ticket on the kitchen screen **379ms** after Send, with no
reload. The charge is on the folio and the event log reads
`guest_session.escalated`, `order.placed`, `order.accepted`, `order.preparing`,
`order.ready`, `order.out_for_delivery`, `order.delivered`.

Until this session nothing could mark an order DELIVERED, so the criterion's
"bump it through to delivered" was not actually reachable. It is now.

What that criterion still wants before it is honestly signed off: **hotel-grade
wifi and the deployed environment**, not localhost. See the deploy note below.

**P1 has one item left, and it is not code.**

1. **Sign the exit criterion off on the deployed environment.** On Railway, on
   hotel wifi, with a printed sticker. The whole chain passes on localhost in one
   automated test across three devices; what it has never run on is the thing the
   criterion actually asks for. This needs a git remote and a Railway app service
   first — P0's last outstanding item, and an account-holder task.
2. **Image upload — blocked, not forgotten.** R2 is not configured (`pnpm status`
   lists `R2_ACCESS_KEY_ID` under "not needed yet"). The dish form takes a URL
   into the same `image_url` column upload will write, and placement snapshots
   it; what is missing is the upload route, the enforced aspect ratio and the
   generated blurhash. It is the only P1 checklist item that is not done.

**After that, P2 · amenities and service requests** — and the plan's own advice
applies: ship P1 to one real floor first. Everything about wifi dead zones, how
staff hold a tablet, and what a kitchen does when two orders land at once will
rewrite the P2 assumptions, and building P2 before that means building it twice.

**The sweep, and what it found.** The pattern had happened twice — a column
written by `provisionProperty()` and read by nothing, with a hardcoded literal on
the screen contradicting it — so it was worth looking properly rather than
waiting for a third. A script matching every column in `src/db/schema` against
the rest of the tree found 84 unreferenced columns. Most are for unbuilt phases
(payments, service requests, POIs, shifts, checkout requests) and are exactly
where they should be. Five belonged to live features and are fixed (see Done).

Two things learned that outlast the fix:

- **A write followed by a `throw` in the same transaction discards the write.**
  That is how the verification lockout came to be announced and then rolled back.
  A heuristic scan found 29 candidates and only that one was real — everywhere
  else the write had matched zero rows, so rolling back is correct — but the
  shape is worth recognising: if an error carries information the database was
  supposed to keep, the throw belongs outside the transaction.
- **My previous STATUS said `minimum_order_minor` was "enforced NOWHERE". That
  was wrong** — `placeOrder()` has always enforced it (place-order.ts). The gap
  was guest-facing: the cart said nothing until the send was refused. Fixed, and
  worth noting as a caution about this file: a claim here is only as good as the
  grep behind it.

**Still stored and unread, deliberately:** `guest_sessions.last_seen_at` (a write
on every request for a figure nothing shows — left alone on purpose) and the four
literal `ROWS` on the room home, which are placeholders for P2 and P3 screens.
`menu_item_availability_windows` is read now.

**One literal removed rather than fixed:** "Chef Bhairav Singh" on the menu
footer. It was one hotel's name in shared code, and there is nowhere for a
property to say who cooks — `properties.branding` is the obvious home and nothing
writes it yet. Worth restoring when branding is real, because the reference's
voice is part of the design.

**A tenancy question is open and deliberately unanswered.** The staff login
needs to know which tenant a browser is signing in to, and that is part of the
tenancy model, so it reads `STAFF_TENANT_ID` and refuses to guess. The two real
answers — a subdomain, or an email → tenant lookup through a SECURITY DEFINER
function like `resolve_qr_routing()` — are written up in
`src/app/(admin)/admin/login/actions.ts`. Decide before a second tenant exists.

**Two things still designed but not wired**, both from S7 and both fine to leave
until they have a screen: `vouchForGuest()` (front desk grants CHARGE with no
prompt at all — needs the admin panel) and `OTP_SMS` as a second escalation
method (`access_policies.allow_otp_sms` is read, and no SMS provider is
configured).

**The tracking screen names no staff.** The reference writes "Bhairav has
started cooking" and "Kishan is crossing the third courtyard", which is the
right voice — but a name has to come from a row. When the runner queue lands and
`assignedRunnerId` is read, put the names back: the copy hooks are in `SUB` in
`src/modules/ordering/track.ts`.

**Still not deployed.** P0 shipped the Dockerfile, `railway.json` and the CI
workflow, all verified locally, but this repo has no git remote and there is no
Railway app service. `pnpm status` reports both under DEPLOY, and
`docs/DEPLOYMENT.md` has the steps. That is an account-holder task.

## Done

| Session | Commit | What landed |
|---|---|---|
| P1 | `04fe4f1` | Dish schedules, and the kitchen's board: a waiting count, an audible alert, timers ageing against the promise, and 86 from the line. Two more literals on the menu screen went with them. |
| P1 | `4e2d6c9` | The sweep: five stored-and-ignored settings now read, and a rate limiter that was rolling back its own lockout. |
| P1 | `d70b306` | Option groups and their options — the last seeder-only part of the catalog. Signed deltas, the shared-dish count on every heading, and `docs/UI-WALKTHROUGH.md`. |
| P1 | `5e645be` | Editorial collections, and their windows honoured — "After 10pm" had been showing at breakfast. `getInRoomDiningMenu()` now requires property-local time. |
| P1 | `7556f8e` | The kitchen's hours and rates, and the guest screens finally reading them. `lib/clock.ts`. Found that a ForbiddenError in a Server Component is a 500, and that dishes are a shared resource across e2e tests. |
| P1 | `89ba116` | The menu editor and the ops console shell. `parseMoneyInput()`. Found a client component pulling `pg` into the browser bundle, and `--plaster-faint` at 2.90:1 on a card. |
| P1 | `8b8f109` | The runner app — the last hop to delivered. `useLiveRefresh()` extracted; three copies of the SSE transport became one. Found that a Date crossing into a client component arrives as a string. |
| P1 | `8abc240` | A rejected order takes its own charge back off the folio (D-027), netted and in the same transaction. Six integration tests, including one credit under two simultaneous rejections. |
| P1 | `6033348` | The guest's tracking screen: the five-step timeline, the arriving-between promise, and `/api/guest/order-stream`. Found that a rejected order leaves its folio line standing, which is now the top of Now. |
| P1 | `c7585ad` | The kitchen display, live: 379ms from a guest's phone to the ticket. Staff sign-in. Found that placeOrder never notified — every hop was live except the order arriving. |
| P1 | `13ab3e8` | LISTEN/NOTIFY fan-out on its own connection, and `/api/kds/stream`. `subscribeToChannel` returns a `ready` promise so a screen cannot miss what happened while it was connecting. |
| P1 | `331e7c6` | The order state machine: `advanceOrder()` with compare-and-set, every hop in event_log, `pg_notify` in the same transaction. |
| P1 | `4c6be0c` | D-012 wired: the one prompt at the charge, escalate-don't-403, order completed in the same request. `placeOrder()` refuses below CHARGE. Fixed a demo:reset wipe order that FK-failed the moment escalations existed. |
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

- **The e2e suite reseeds before it runs** (`tests/e2e/global-setup.ts`), and it
  has to. `verification_challenges` counts failed attempts PER ROOM across
  challenges, so the escalation test — which answers wrong once on purpose —
  locked its own room out after a few runs. The rate limiter was working; the
  suite was not repeatable.
- **`STAFF_TENANT_ID` must be set** for anything on a staff surface. Without it
  the login refuses rather than guessing which hotel to sign someone in to.
  `deadbeef-0000-4000-8000-000000000001` for the demo.
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
- **A thrown `ForbiddenError` in a Server Component is a 500, not a 403.** Next
  has no error mapping to run there, so it renders the error boundary and the
  staff member reads "Application error". Admin PAGES go through
  `adminAccess()` (src/app/(admin)/admin/guard.tsx) and render a sentence;
  route handlers and server actions still throw and are still mapped once.
- **An e2e that 86s a dish breaks any test ordering that dish.** `placeOrder()`
  refuses a cart holding an unavailable one, and the failure surfaces as a Send
  button that does nothing. `ownDish()` in the suite keeps the editor tests on
  dishes nothing orders — dishes are a shared resource across tests exactly like
  rooms are.
- **A client component must not import a VALUE from a `modules/*` index.** The
  index pulls the module's db layer, so `pg` follows it into the browser bundle
  and the build fails with `Module not found: Can't resolve 'net'` — which reads
  like a broken dependency rather than what it is. `import type` is fine (types
  are erased); a runtime constant has to arrive as a prop from the server
  component. Nothing but `pnpm build` catches this — not typecheck, not lint, not
  the unit tests. The e2e suite builds, so CI does.
- **`--plaster-faint` is 45%, and the number matters.** At the 38% it started at
  it was 2.90:1 on `--ink-600`, under even the 3:1 bar for UI text: one token was
  doing the job of the reference's two values (.38 over the page, .45–.48 on a
  card). `tests/unit/theme-contrast.test.ts` pins it now, and states that it may
  never carry body copy.
- **A `Date` crossing into a client component arrives as a STRING.** The prop
  type still says `Date`, so `readyAt.getTime()` typechecks, lints, and is a 500
  on the server render — which is how the runner queue shipped broken for one
  test run. Wrap it: `new Date(value).getTime()`. Both `Age` (KDS) and `Since`
  (runner) now say so in a comment; anything new that formats a timestamp on the
  client needs the same.
- **The SSE transport is shared, the authorization is not.** `useLiveRefresh()`
  in `src/components` is the only copy of the EventSource-plus-`router.refresh()`
  loop. Each surface keeps its own route handler, because the authorize step and
  the notification filter are what a mistake there costs (D-026).
- **Run the e2e suite against a LOCAL Postgres too, not just the integration
  one.** Against Railway Singapore the guest tests time out: Playwright's
  default per-test timeout is 30s and one placement test makes a dozen page
  loads at ~3.6s each. Against the docker container it is 26 tests in ~40s and
  the same suite passes. Same env as the integration recipe above, plus
  `STAFF_TENANT_ID`:
  ```
  export DATABASE_URL=postgres://app_user:app_user@localhost:55432/guest_services
  export DATABASE_MIGRATION_URL=postgres://postgres:postgres@localhost:55432/guest_services
  export STAFF_TENANT_ID=deadbeef-0000-4000-8000-000000000001
  pnpm demo:reset && PORT=3200 NEXT_DIST_DIR=.next-e2e pnpm test:e2e
  ```
- **`db:bootstrap` does not reset an existing role's password.** It prints
  "role app_user already exists" and moves on, so a container whose `app_user`
  was created with a different password fails everything after it with a bare
  `28P01`. Fix it as the owner — and note `ALTER ROLE … PASSWORD` cannot take a
  bind parameter, same trap as the `DO $$ … $$` note above:
  `ALTER ROLE " + c.escapeIdentifier(role) + " PASSWORD " + c.escapeLiteral(pw)`.
- **`STAFF_TENANT_ID` now lives in `.env`** (gitignored, demo tenant). It used
  to have to be exported by hand, and without it every staff surface answers
  "This deployment has no staff tenant configured" — which reads like a bug in
  the login rather than a missing variable. CI sets it in the workflow.
- **A guest page's SSE stream is authorized per route, not by the middleware.**
  `/api/guest/order-stream` resolves the guest cookie itself and returns 401
  rather than a redirect: `EventSource` cannot follow a redirect usefully, and a
  302 to the scan route made the client retry in a loop.
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
