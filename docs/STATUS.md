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

> Editing note: match a LINE that is exactly `## Now` — never a substring.
> This paragraph and the one above both contain that text, so an index-of on
> `"## Now\n"` finds the note, not the heading, and splices the new section
> into the middle of this sentence while deleting the real heading. That has now
> happened twice, once to a session that had just read this warning.

## Now

**Production is green and verified, and is one commit behind this repo.**

    https://innstant.in                        the site, /demo, and the app
    https://innstant.in/r/the-kesari-214       the demo room (stable link)
    https://innstant.in/admin                  staff console

Gates locally: typecheck, lint, **370 unit tests**, build — all green.
`/api/health` reports migrations 8/8 with none pending, 54 tables with RLS
enabled and forced.

**The skeleton loaders are finished and NOT yet deployed.** All eleven
`loading.tsx` files are committed and verified locally; production is still
running `b2904c2`. Deploying them is the first thing to do — see below.

### Pick up here

**1 — Deploy.** The guest app has eleven loading screens now (D-077) and the
deployment has none of them. Nothing else is pending.

    npx --yes @railway/cli@latest up --service kesari --detach

Takes 5–10 minutes. Poll for the actual change — a scan of
`https://innstant.in/r/the-kesari-214` on a throttled connection should show a
skeleton, not the previous screen — rather than reporting "deployed" from the
upload line.

**2 — A scheduled demo reseed.** The single most persistent operational
problem in this project. See "Open issues" below. **The seeded stays run out
on 5 October 2026**, so this now has a date on it.

Run `pnpm quality` (localhost:3999) to see where the gates stand before and
after either of those — it is faster than four terminals and it will tell you
when a green belongs to an older tree than the one in front of you.

### Open issues and decisions

**The demo data expires.** `DEMO_STAY_NIGHTS` is 14 and the last reseed was
21 September 2026 — **the seeded stays run out on 5 October 2026**. After that
`/demo` shows its "the demo room isn't open" page until somebody runs
`pnpm demo:reset`. The LINKS no longer break (D-070, they are
`the-kesari-<room>` now and survive a reseed); it is the stay behind them that
lapses. A cron would end this permanently and has not been built.

**Your local dev server may not be talking to Railway.** A `next-server` on
:3000 was observed holding a connection to a local Docker Postgres on
`localhost:55432`, not to the Railway proxy — almost certainly a `DATABASE_URL`
exported in the shell that launched it, which beats `.env`. Check with
`echo $DATABASE_URL` in that terminal. Worth deciding deliberately: pointing
local dev at production means `pnpm demo:reset` wipes the live demo.

**`APP_URL` still says the railway subdomain**, not `innstant.in`. Both serve
everything so nothing is broken, but `APP_URL` is what a printed sticker's URL
is built from. Change it and reseed before any print run.

**The site's book-a-demo form does not submit.** It collects everything and
hands over a `mailto:`, and says so on the page (D-062). A real endpoint needs
somewhere to put a lead, which is the mail-provider decision below wearing a
hat.

**The logo strip reads as a customer list.** Six names — The Kesari, Aramaya,
Node, Hôtel Verre, Deodar House, Stack — under "Designed for independent
properties across India". They were the demo palettes the Themes section
explained, and that section was removed. Replace them or drop the strip.

**Two open design calls, both deliberately left alone:**

- The guest theme's radii are sharp — `--radius-lg` is **4px** (D-050, part of
  what stops the app looking like a template). The menu-card reference was
  softer. Changing it softens every surface in the guest app at once, so it is
  a theme decision, not a menu one.
- A menu card's count sums **all variants** of that dish. One gentle and one
  fiery reads as 2. Tracking only the default variant instead is a small
  change (D-076).

**Still needs somebody, not a session:**

1. **A mail provider.** No self-service password reset without one, and no
   home for a demo-request lead.
2. **How a signed-out browser picks a tenant.** `STAFF_TENANT_ID` is the
   stopgap in `admin/login/tenant.ts`; `DEMO_TENANT_ID` falls back to it.
   Correct at one tenant, wrong at two. Changes the tenancy model, so
   CLAUDE.md says ask.
3. **Client onboarding stays out** — creating a tenant is above the tenant
   boundary. `provisionTenant()` / `provisionProperty()` remain the way.
4. **`role:manage`** — custom roles are assignable but not creatable.
5. **Image upload and payments** are absent on the deployment: no R2 or
   Razorpay keys. Everything else works.
6. **No git remote.** `railway up` ships the working tree, so nothing is on
   GitHub and CI has never run. P1's exit criterion is still unsigned.

### What landed this session

`pnpm quality` (D-078) — every validation this repo has on one page, with
what each proves, a Run button, streamed output, and a result stamped with
the tree it ran against so a stale green says so. Its own process on
localhost:3999, never deployable, because it spawns build tooling. The
environment checks are now shared with `pnpm status` rather than copied
(`scripts/lib/project-checks.ts`); that command's output is unchanged.

Two hazards it surfaced, both found by using it: pressing Build would have
written into the dev server's `.next` (it uses its own distDir now, and
restores the two files `next build` rewrites), and pressing Run on the
integration suite would have provisioned test tenants into **production** —
so that row names its target host and asks first.

Skeleton loaders, finished (D-077). Eleven `loading.tsx` files, one per guest
segment, each built against its own `page.tsx` so nothing moves when the
content lands. The primitive gained `SkeletonHeading`, `SkeletonTotal` and
`SkeletonStep`, and `SkeletonBar` now takes an optional title — real where the
route knows it, a grey bar where the title is data.

Found on the way: making `.screen` a flex column so the service screen could
anchor its button to the bottom edge made every screen taller than the
viewport shrink its own children, and the amenities bars overlapped the
heading under them. Caught by screenshotting all eleven rather than by a test.

### Previously

The marketing site at `/` and the `/demo` door beside it (D-062, D-063);
business-facing copy and page motion (D-067, D-068); the real logo artwork and
`pnpm logo:build` (D-065); stable demo QR codes and a readable dead-link page
(D-070); Plan my day, P4's read half (D-069); the amenities screen led by real
demand (D-071); a bell that rings and four distinct tile icons (D-072);
`lucide-react` and the CLAUDE.md rule behind it (D-073, D-074); menu cards with
add/remove on each (D-075, D-076).

**`pnpm status` re-derives all of this from the repo and the database.** If it
disagrees with this file, it is right and this file is stale.

## Done

| Session | Commit | What landed |
|---|---|---|
| P4 | `5018941` | `pnpm quality` — every validation on one page, runnable, with what each one proves and a result stamped with the tree it ran against. Its own loopback process, never deployable, because it spawns build tooling. Found two hazards a button makes worse than a command: Build writing into the dev server's `.next`, and the integration suite provisioning tenants into production (D-078). |
| P4 | `a029357` | Skeleton loaders finished: eleven `loading.tsx` files, one per guest segment, each shaped like the page it stands in for, plus three new shapes on the primitive and a title that is real when the route knows it (D-077). Found `.screen` as a flex column shrinking every long screen's children until the amenities bars overlapped the heading — caught by screenshotting all eleven, not by a test. |
| P4 | `e460b8f` | The marketing site, the demo door, and a session of guest-app work: business copy and motion on `/`, the real logo, stable demo links, Plan my day, amenities led by demand, lucide icons, and menu cards that add and remove (D-062 to D-076). Skeleton loaders begun — the primitive is in, the eleven `loading.tsx` files are not. |
| P3.5 | `4f1db5b` | The marketing site at `/`, and the demo door beside it. Three themes now, two more self-hosted faces, and an SVG logo. `/demo` asks a visitor's name once, writes it to `demo_visitors` — the one untenanted table, INSERT-only under forced RLS — and opens the seeded room at FULL by a recorded vouch, so the four-digit prompt never fires for a stranger while a sticker scan still gets it (D-062, D-063). Found the form doing nothing: a Server Action redirect is followed by the client router, which cannot navigate to a Route Handler. |
| P3.5 | `41cf78d` | `/admin/property` split into three tabs — This hotel, Room types, Floors & rooms. The two settings jobs went from a shared 4,400px page to 900px each, and the view switch moved into the shared console stylesheet so the desk and the property screen use one control (D-061). |
| P3.5 | `2a2c3e9` | The console streams. It was the last surface without `useLiveRefresh`; it now subscribes to the order and request staff streams, opt-in per permission. The desk opens on `Needs you` instead of thirty vacant rooms, and the folio stopped pushing its own total below the fold (D-060). |
| P3.5 | `c2902bc` | Deployed to Railway, and the 72 files behind it: the staff console and guest app designs, the Kesari theme restored to the guest side, the activity history, the cart review row, the guest's name on the home screen, and the four bugs found by looking at screens rather than tests (D-048 to D-059). |
| P3.5 | `c2902bc` | The guest app returns to the Kesari theme and the room home is rebuilt to the export — masthead, CSS arch, tile grid, one pinned button (D-050, D-051). Found a QR that minted an already-expired session and looped forever (D-052), and a `.pill` declared twice in one stylesheet painting a blob over the menu's category rail. |
| P3.5 | `c2902bc` | The staff console design: three-column KDS with an 86 tray and day/night, a shared floor-phone header with clock in/out, and `/admin/desk`. The palette was replaced product-wide (D-048) and three state-machine changes the design implied were refused (D-049). Found the night mode painting itself white — `var()` in a custom property resolves where it is declared, not where it is used. |
| P3.5 | `52d8ae2` | The ops console's UI: a permission-filtered rail, panels, rows on shared column tracks, row forms anchored instead of inserted, three named status tones, and an Overview that is a dashboard. Found `data-available` dimming every OCCUPIED room, and a `<select>` that had silently moved the hotel's clock to Africa/Abidjan. |
| P3.5 | `64c2d8e` | Staff and roles — invite by one-time link, deactivate, assign. Migration 0006. The phase's exit criterion, and the item a pilot needed first. Found two: a raw-SQL timestamp reaching `Intl` unwrapped, and every page throwing "Application error" at a revoked session instead of sending it to the sign-in form (D-045). |
| P3.5 | `00dd2d4` | Room types and the hotel's own settings. The currency turned out to be write-once from the first charge — nothing converts a past bill and there is no exchange rate in this product. |
| P3.5 | `a15054a` | Reprinting a sticker, which `version`'s own comment has claimed since migration 0000 and no code did. Kills the old code, keeps the guest signed in. Found GuestLink caching an assembled URL that a reprint would have made stale. |
| P3.5 | `5564454` | The building — floors and rooms from a screen, each new room minting its QR code. Phase added to the plan after a sweep found 21 of 55 permissions with no caller. Found a folio readable by CONCIERGE. |
| P3 | `2d23757` | Settling at the desk — the pair `postFolioLine()` has refused since P1. P3's exit criterion met, bar taking a card online. Found the guest's bill saying "Paid" without saying how. |
| P3 | `e38da4a` | The PmsAdapter seam, ManualAdapter and the outbox. The interface came out narrower than EXTENSION-POINTS sketched, for two reasons only visible once the operations existed. |
| P3 | `fbc56f4` | Guest 360. Found a charging hold that only covered orders, and `ForbiddenError` throwing away every specific message it was given since P1. |
| P3 | `a5d56cf` | The front desk: the room list, check in, check out. Found that #10 was unreachable rather than true, and that a sixth nav item broke a screen three clicks away. |
| P3 | `6b17364` | Leaving later — the checkout-change flow, both ends. Found the verification lockout counting successful verifications as brute-force attempts. |
| P3 | `9299d4d` | The guest folio, and the FULL tier that reaches it. Found that FULL was unreachable by any path, and that a cancelled chargeable request was never credited back. |
| P2 | `f55cbb9` | The request catalog, editable. Found that `<details>` keeps its open state across `router.refresh()` — which the bell wants and an e2e that clicks the summary twice does not. |
| P2 | `1840a0d` | The bell — the in-app channel, and P2's asterisk with it. Found `notificationsFor()` ordering by `created_at` alone despite promising the unseen first, and this file's own `## Now` heading missing, eaten by exactly the splice its editing note warns about. |
| P2 | `784f95f` | The SLA worker (D-028) and `modules/notifications`. Found the duty-manager lookup excluding INVITED admins — a new property's escalations would have gone nowhere. |
| P2 | `320a3b3` | Shifts, zones, and auto-routing. P2's exit criterion is half met — routed without anyone assigning; breaches do not escalate yet. |
| P2 | `2e18c03` | The floor board, and the request streams both ways. Found `useLiveRefresh` hardcoding the event name, and a seeded request with no lines. |
| P2 | `e9e7e51` | The request state machine, `raiseServiceRequest()`, `/amenities` and the one tap. Nine more write-only columns retired. |
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

**The room links below are now stable** (D-070). They used to be random and
therefore reissued by every `demo:reset`, which broke every link anyone had
written down — including this table, twice in a week. The demo property's
codes are `the-kesari-<room>` and survive a reseed, a wipe, and a rebuild of
the database. Real properties still get random codes and always will; a
sticker is a capability URL.

**The seeded stays run 14 nights** (`DEMO_STAY_NIGHTS`), so the demo still
needs a reseed roughly fortnightly — the LINK no longer breaks, but the stay
behind it expires. Last reseed: 21 September 2026, stays out 5 October. A
scheduled reseed is still the real fix.

A room link whose stay has ended now renders a page saying so, with a way back
to `/demo`, instead of a blank browser 404.

| Role | Email |
|---|---|
| PROPERTY_ADMIN | gm@thekesari.example |
| FRONT_DESK | frontdesk@thekesari.example |
| F_AND_B_MANAGER | fnb@thekesari.example |
| KITCHEN | kitchen@thekesari.example |
| RUNNER | runner@thekesari.example |
| HOUSEKEEPING | housekeeping@thekesari.example |

Demo tenant id is fixed at `deadbeef-0000-4000-8000-000000000001` so it is
identifiable in a shared database.

**QR codes are regenerated on every reset — re-read them from the seeder
output, never cache one.** This note is here because it was ignored: a link
copied before the last `demo:reset` 404'd, and the 404 was correct. An unknown
code, a revoked sticker and an empty room all return the same 404 on purpose, so
somebody scanning from a corridor learns nothing from which it was.

The occupied rooms at the time of writing, on the deployment:

| Room | Link |
|---|---|
| 214 | https://innstant.in/r/the-kesari-214 |
| 105 | https://innstant.in/r/the-kesari-105 |
| 210 | https://innstant.in/r/the-kesari-210 |
| 301 | https://innstant.in/r/the-kesari-301 |

All 34 are in `.demo-seed.json`, and the desk copies any of them from
`/admin/rooms`. Verification digits, where a charge prompts for them: `1111`.

---

## Environment notes

Things that cost time to rediscover.

- **A running server can be pointed at a different database than `.env` says,
  and nothing on screen tells you.** Every room link 404'd on a local `:3000`
  while the identical link worked elsewhere. The server held three connections
  to `localhost:55432` — a local Postgres with the full schema and ZERO rows —
  and none to Railway, because it had been started from a shell whose
  `DATABASE_URL` was set. Shell env beats `.env`; Next's `loadEnvConfig` does not
  overwrite what is already in `process.env`.

  `lsof -nP -a -p <pid> -iTCP -sTCP:ESTABLISHED` answers it in one line, and is
  faster than any amount of reading. macOS will not let you read another
  process's environment, so the sockets are the evidence.

- **`pnpm start` reads `.next/standalone/.env`, not the root one.** The
  standalone server runs with its cwd inside the build output, and the build
  copies `.env` in. Edit the root `.env`, restart with `pnpm start`, and you
  silently get the values from whenever you last built. `pnpm dev` reads the
  root file and does not have this problem.

- **`pnpm dev:lan` is how you demo on a phone.** `next dev` already binds every
  interface and prints the LAN address, so reaching the server was never the
  problem — `APP_URL` was. Every guest QR link is built from it and deliberately
  never from the request (standalone binds 0.0.0.0, so a request-derived URL
  behind Railway's proxy is an internal hostname), and `.env` ships
  `http://localhost:3000`. On a phone, `localhost` is the phone. The script
  resolves the machine's LAN address, hands it to the dev server as `APP_URL`
  for the life of the process, and writes nothing to `.env` — the address
  changes with the network, and a pinned one goes stale silently.

  It ranks interfaces rather than guessing: wifi and ethernet first, VPN tunnels
  and Docker bridges last, and it prints the runners-up so a wrong pick is
  visible rather than mysterious. On this laptop it correctly chose `en0`
  (192.168.x) over `ipsec0` (10.245.x).

- **`tx.execute<T>()` ASSERTS its generic; it never parses.** A raw query's row
  type is what you hope the driver returns, and nothing checks it. A
  `timestamptz` typed as `Date` arrived as a string and took `/runner` down with
  `.getTime is not a function` — see D-053. Anything crossing that boundary is
  effectively `unknown`: the mapper converts it, it does not re-declare it. To
  find the next one:
  `grep -rl 'tx.execute<' src/modules/` then check each `_at` field is wrapped
  in `new Date(...)`, not passed through.

- **`Array.sort` does not call the comparator on a list of fewer than two.** A
  crash inside a sort is invisible until the data has two rows in it, which is
  why this one survived dev, every screenshot and the whole e2e suite — the e2e
  walks a single order end to end. When a bug only appears "in production", ask
  what the production data has more of before assuming it is the environment.

- **`var()` inside a custom property resolves where it is DECLARED, not where it
  is used.** `--bg: var(--paper)` on `:root` computes to the light paper and
  inherits that finished colour down the whole tree; a descendant redefining
  `--paper` changes nothing. It cost the kitchen display's night mode, which
  shipped with `data-scheme="dark"` on the element, every primitive correct
  underneath it, and a white screen. typecheck, lint, 286 unit tests and
  `next build` were all green. Every alias in `theme.css` whose value mentions
  `var()` is now declared under both selectors, in a block after both palettes —
  including `--ink-dim` and `--ink-faint`, which reference `--ink`. See D-048.

- **Exporting a function from a `'use client'` module and calling it on the
  server compiles, builds, and throws at request time.** "Attempted to call
  isNight() from the server but isNight is on the client." A client module's
  exports become references once they cross the boundary. Anything both sides
  need goes in its own module with no directive on it — `kds/night.ts` is the
  example.

- **`tests/integration/notify.test.ts` fails 5 of 6 on this database, and it is
  not your change.** `ConflictError: That order is already on its way to the
  kitchen`, from `claimIdempotencyKey`. The fixture uses hardcoded keys
  (`notify-1`, `notify-2`…) and leans on `afterAll` cleanup, so any interrupted
  run poisons every run after it. `notifications.test.ts` fails one for the same
  family of reason. Confirmed identical from a pristine worktree at `708d5af`
  before blaming anything: `git worktree add <dir> HEAD`, copy `.env`, symlink
  `node_modules`, run the one file. Cheaper than a bisect and it answers the
  question outright.

- **The guest PWA redirect-loop was a real bug, and is fixed (D-052).** The
  symptom was `/r/<code>` → `/home` → back, forever, behind a blank white page.
  The cause was a stay 15 days past its checkout: the scan still succeeded and
  minted a session whose cookie had already expired, so the browser discarded it
  and `/home` sent the guest back to scan again. `scanQrCode()` now refuses a
  stay past checkout with the same error as "no active stay".

  The database is still drifted from the seed: `.demo-seed.json` holds a
  `propertyId` that is not the one in the database, its QR codes 404, and the dev
  server logs `function sla_sweep_properties() does not exist` every sweep. The
  three demo stays were moved forward 21 days by hand so the guest app could be
  opened at all. `pnpm demo:reset` is the real fix; it wipes and reseeds, so it
  is the account-holder's call, not a session's.

- **Two components in one CSS module cannot share a class name, and nothing
  warns you.** `menu.module.css` declared `.pill` twice — the category rail's
  sliding indicator and the floating cart button — and the second won every
  property they shared, so the rail wore a 58px plaster blob with `position:
  fixed`. It had been there since the menu was built and no gate could see it.
  `for f in $(find src -name '*.module.css'); do grep -oE '^\.[a-zA-Z][a-zA-Z0-9]*' "$f" | sort | uniq -d; done`
  lists the candidates; most hits are a base rule plus a pseudo-class, so read
  before renaming.

- **`next build` while `next dev` is running corrupts the dev server.** They
  share `.next`, and the running server then throws
  `__webpack_modules__[moduleId] is not a function` on every route — which looks
  exactly like a code bug you just introduced. Kill the dev server, `rm -rf
  .next`, restart.

- **Query the database for a QR code rather than trusting `.demo-seed.json`.**
  `select q.public_code, r.number from room_qr_codes q join rooms r on
  r.id = q.room_id where q.revoked_at is null` — and join `stays` for one that is
  CHECKED_IN, because a vacant room's code does not open a guest session. The
  stay status enum is `RESERVED, CHECKED_IN, CHECKED_OUT, CANCELLED, NO_SHOW`;
  there is no `IN_HOUSE`, whatever the front desk calls it.

- **`pnpm` needs Node 22 and the shell does not always have it.** `nvm use`
  inside a one-shot command does not always stick; `export NVM_DIR="$HOME/.nvm";
  . "$NVM_DIR/nvm.sh"; nvm use 22.23.2` then `npx <tool>` does.

- **The SSE indicator says "Reconnecting" for the first ~3 seconds.** A
  screenshot taken at `networkidle` catches it mid-handshake and looks like a
  broken feature. It reaches "Live" at about t+3s on the KDS.

- **A stray server on :3000 makes the whole e2e suite test the WRONG BUILD, and
  it looks like a broken feature.** `playwright.config.ts` sets
  `reuseExistingServer: !CI`, and its own header comment warns about this. Left
  over from an earlier run, a `next-server` on :3000 is silently adopted as the
  system under test, so the suite runs against a build from before your changes.
  It cost a session: twenty-seven failures across the guest menu, the floor board
  and the staff invite flow — areas with nothing in common, which is the tell,
  because no single change breaks all three. `pgrep -fl next-server` and kill it
  before believing a red suite, or use
  `PORT=3200 NEXT_DIST_DIR=.next-e2e pnpm test:e2e`.
- **Do NOT use local `psql` to decide whether the database is up.** It is version
  14 against PG 18 and stalls after a successful TCP connect, with no error, for
  30–90s — the note two bullets down has said so since P1. Mistaking that for a
  wedged Docker port proxy cost a Docker Desktop restart that fixed nothing and
  stopped the containers. `pnpm status` uses the `pg` driver and answers in
  seconds; that is the probe.
- **A `<select>` silently substitutes the first option** when its value matches
  none of them, and the next submit writes it. See D-047 — it moved a hotel's
  timezone. Any edit form rendering a stored value as a select needs the value
  guaranteed present; `offeredTimezones()` does it for zones.
- **Screenshotting the console:** build, run `.next/standalone/server.js`, and
  kill the old server FIRST — `bundle:static` deletes the previous build's
  hashed CSS, so a survivor serves HTML pointing at files that no longer exist
  and every page renders unstyled. That looks exactly like a broken stylesheet.
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
- **`NEXT_DIST_DIR=.next-e2e pnpm build` rewrites `next-env.d.ts`** to point its
  `routes.d.ts` reference at `.next-e2e`. It is a generated file that says "do
  not edit" and it will show up in `git status` after every e2e build. Check it
  out again before committing — a committed `.next-e2e` reference breaks
  `pnpm typecheck` for anyone who has only ever run `pnpm build`.
- **A `<details>` panel survives `router.refresh()` and that is the point.** Its
  open state is DOM, not React, so a live surface that re-renders under an open
  popover leaves it open. The bell relies on this: an alert arriving while the
  GM is reading the list must not snap the list shut. It also means an e2e that
  clicks the summary a second time CLOSES it — which is how the bell's first test
  failed.
- **A staff SSE route that filters on a person must take the id from the
  session, never the query.** `/api/notifications/stream` checks a session and a
  property and then filters on `session.staffUserId`; there is no
  `notification:read` permission because the question is not "may this role read
  alerts" but "is this your alert". A `?staffUserId=` parameter would have been
  every bell in the hotel.
- **This file's `## Now` heading has been eaten twice by a substring splice**,
  the second time by a session that had just read the warning against it. The
  text `## Now` appears in the editing note as well as in the heading, so
  `s.index('## Now\n')` finds the note. Match a whole line. `pnpm status` fails
  loudly when the heading is missing, which is how both were caught.
- **A client component may import a TYPE from a `modules/*` index and nothing
  else.** The request editor needs the four category keys and their labels; both
  are declared in the component rather than imported, because a value import
  pulls the module's db layer and `pg` follows it into the browser bundle. Only
  `pnpm build` catches it. The e2e suite builds, so CI does.
- **Playwright maps `<details>` to role `group` and `<summary>` to nothing
  useful.** `getByRole('button', { name: 'Edit' })` matches neither, so an
  assertion that a read-only account has no edit control passes whether or not
  the control is there. Locate the disclosure by `getByRole('group')` and open it
  through its `summary`.
- **`SELECT ... FROM roles` needs `property_id IS NULL OR property_id = $1`.**
  System roles are tenant-wide with a null `property_id`; only custom roles carry
  one. A plain `WHERE property_id = $1` returns nothing at all, which reads like
  an RLS problem and is not.
- **The e2e suite could not pass between 01:00 and 07:00 property-local**, and
  nothing said so. Two ordering tests asserted `/Kitchen open until/` while the
  seeded kitchen closes at 1am, so a run after midnight failed on the app being
  correct. The kitchen-settings tests had always matched both wordings
  (`/Kitchen open until 1am|The kitchen opens at 7am/`); these two had not. CI
  runs in UTC, so the window was 19:30–01:30 UTC — a quarter of the day.
  Anything asserting a time-dependent line needs both branches.
- **Verification is rate-limited per ROOM: five attempts in thirty minutes,
  counted across challenges.** Each e2e test that answers the prompt spends one
  attempt per answer, right ones included, and the ordering and amenities tests
  already spend four of room 214's. A new suite that verifies has to bring its
  own room — 210 is seeded with a stay and a folio for exactly that. Rooms are a
  shared resource here the way carts already are.
- **`requireTier()` WRITES.** It inserts an `access_escalations` row every time
  it is called with an insufficient tier, so calling it while rendering a page
  reached by a `<Link>` means Next's viewport prefetch mints escalations and
  challenges for guests who never tapped. Abandonment rate and the per-room
  attempt count are both load-bearing; read the tier with `tierAtLeast()` on a
  page and start the escalation from the submit.
- **A `<details>` keeps its open state across `router.refresh()`** — DOM state,
  not React. The bell and the request-type editor both rely on it, and an e2e
  that clicks the summary a second time CLOSES the panel it meant to reuse.
- **`drizzle-kit generate` numbers from its own journal, not from the migrations
  directory.** With 0001–0004 hand-written and untracked by drizzle, it produced
  `0001_chief_earthquake.sql`, which sorts BEFORE `0001_rls.sql` and would have
  run at the wrong point. `db:migrate` applies files in filename order and tracks
  them by filename, so rename the generated file to the next real number, rename
  its `meta/NNNN_snapshot.json`, and fix the `tag` and `idx` in
  `meta/_journal.json`. Keep the journal entry — `db:generate` diffs against it.
- **A new table needs its own RLS block.** 0001's verification sweep runs before
  any later table exists, so it cannot catch one added in 0005. Enable and force
  RLS plus the `tenant_isolation` policy in the migration that creates the table;
  `db:migrate` prints the protected count and the isolation suite asserts the set.
- **Drizzle flattens an array parameter in `sql` templates.** `${['A','B']}`
  becomes comma-separated params and Postgres reads `"REQUESTED"` as a malformed
  array literal. Use `sql.join(values.map((v) => sql`${v}`), sql`, `)` inside an
  `IN (...)` — one placeholder per value, and no SQL built by concatenation.
- **A fixed calendar date in a fixture mints already-expired guest sessions.**
  `expires_at = scheduled_checkout_at + grace`, so a stay due out in 2026-03 has
  sessions that `resolveGuestSession()` filters out, and the failure reads like a
  session bug. Build stay fixtures relative to now (`tomorrowAt(11)`) and assert
  on the property-local HOUR rather than on a UTC instant.
- **Two e2e suites sharing a room need one serial parent.** "your stay" asserts
  exact folio totals and "leaving later" then puts ₹2,500 on the same folio; two
  workers ran them in either order and the totals were a coin flip. They are
  nested inside one `test.describe('room 210')` with `mode: 'serial'` now, which
  makes the dependency explicit rather than accidental.
- **A success toast inside a queue row is never read.** The desk's approve
  unmounts the row it was rendered in — the row moving to "Already answered" is
  the feedback, and it is the durable kind. Errors keep the row, so they stay.
- **The admin console's sticky bar had a fixed 56px height, and a sixth nav item
  broke a screen three clicks away.** At 412px the nav outgrew one line, the
  overflow sat on top of the page, and the failure surfaced as an option-group
  `<summary>` that would not open — Playwright said "`<span class=optionName>`
  intercepts pointer events", which points at the wrong element entirely. The bar
  wraps and uses `min-height` now. Desktop-first still has to DEGRADE.
- **`atLocalHourOnSameDay()` used to inherit its reference's seconds.**
  `localTimeAt` resolves to whole minutes, so shifting by whole minutes left
  `14:00:00.837` behind and two calls a millisecond apart produced two different
  2pms. Anything building an instant from a local hour has to land on the hour.
- **`guests` is tenant-scoped and survives between integration tests** on purpose
  (EXTENSION-POINTS §2) — `beforeEach` wiping `stays` does not wipe them. A test
  asserting `guestIsNew` needs a phone number no other test in the file uses,
  which is the behaviour rather than a nuisance: a returning guest keeps their
  history.
- **A JSX comment cannot sit in the true-branch position of a ternary.**
  `{cond ? ({/* … */}<span/>) : null}` is a parse error, not a comment. Put it
  above the expression.
- **The guest menu's bottom pill is EITHER the kitchen line or the cart** — one
  slot, and the cart wins. Room 214's cart is shared between the dish-screen test
  and the kitchen-settings test, so whether the second could see the line at all
  depended on which ran first. It passed for months and failed the day a new
  suite changed the interleaving. `emptyCart()` first when asserting on that pill.
- **`ForbiddenError` used to hold a fixed public message.** Five throw sites had
  each written a specific sentence and every one was replaced before a person saw
  it. If you add an error class, make the constructor argument the thing the
  person reads — and if a refusal genuinely should not explain itself, say the
  vague sentence AT the throw site and put the detail in `context` (D-037).
- **RLS policies are tenant-scoped, not property-scoped.** Any query that spans
  properties in a group needs an explicit `property_id` filter; the database will
  not catch a missing one, and a group's second hotel is the first place it
  shows.
- **An interface sketched before the code is a hypothesis.** EXTENSION-POINTS'
  `PmsAdapter` had six methods; two of its assumptions were false once the
  operations existed, and building it as drawn would have put a network call
  inside the transaction D-033 spent a session making atomic. Read the sketch,
  then read the code, then write the interface — and mark the sketch superseded
  rather than leaving two shapes in the docs (D-038).
- **`vi.spyOn(await import('@/modules/…'), 'fn')` works for swapping a module
  function in the integration suite.** The PMS tests use it to make one property
  pretend it runs Opera. Restore with `vi.restoreAllMocks()` in `beforeEach` or
  the next test inherits the fake.
- **A `done` message inside a form the action unmounts is never read.** Twice
  now: the desk's checkout queue (the row leaves for "Already answered") and the
  payment form (a settled bill offers none). Assert the durable outcome in the
  e2e, and keep the message only where the form survives — a PARTIAL payment
  leaves it standing and "₹518 still on the room" is worth reading.
- **`await` inside a non-async arrow passed to `withTenant()` is a PARSE error**,
  not a type error, so vitest fails the whole file with no test names. Resolve
  the value first: `const id = (await folio())!.id` then `scoped((tx) => …id)`.
- **`describeOpenState` has THREE wordings and the e2e long covered two.**
  "Kitchen open until 10:45pm" while open, "The kitchen opens at 7am" when the
  next opening is TODAY (01:00–07:00), and "The kitchen opens Thursday at 7am"
  when it is tomorrow (after closing until midnight). The suite was made
  time-independent once and still could not pass in the evening. Any assertion on
  that line needs all three.
- **A guest link must be built from `APP_URL`, never from the request.**
  Standalone binds 0.0.0.0, so `request.url` behind Railway's proxy is an
  internal hostname — the same trap that made redirects relative. The admin's
  room list falls back to `window.location.origin` in the browser when `APP_URL`
  is unset, which is the origin somebody is actually on.
- **`navigator.clipboard` needs a secure context.** A hotel running this on plain
  http over the LAN has none and the call rejects, so a copy button needs a
  visible fallback — the room list reveals a selected read-only field.
- **`room_qr_codes` is seeded in `beforeAll` and the per-test wipe does not touch
  it.** A test that revokes or reprints a code has to put it back, or every later
  `scanQrCode(a.qrCode)` in the file fails with "revoked".
- **A permission with no caller is a feature nobody can use.** Sweep for them —
  grep each name in `PERMISSIONS` against `src/` and discount `permissions.ts`
  itself. That sweep is what produced P3.5, and it has now caught `qr:read`,
  `guest:vouch`, `stay:check_out`, `request_type:manage` and `room:manage` in
  turn. It also catches the inverse: `folio:read` had no caller because the guest
  360 page was showing a folio behind `guest:read`.
- **`floors` has no `archived_at` and `rooms_property_number_uq` has no partial
  predicate.** So a floor is hard-deleted (only when empty) and an archived room
  keeps its number for ever. Both are deliberate; the setup screen explains each
  rather than working around it.
- **A room created outside `provisionProperty()` needs its QR code minting in the
  same transaction.** Nothing would report a room without one — every screen on
  the guest surface assumes the code exists, so the guest finds out.
- **WebKit still segfaults locally, reconfirmed.** The API-request tests pass
  (no browser launches); anything that opens a page dies. CI on Linux is the
  only place iOS Safari is actually exercised.

---

## How to resume in a new session

Paste this:

> Read `CLAUDE.md`, `docs/STATUS.md` and `docs/DECISIONS.md`, then run
> `pnpm status`. **P3 is complete and P3.5 · running the property has begun** —
> a phase that was not in the original plan. Pick up the first item under the Now
> section and follow it to the
> definition of done in CLAUDE.md — types, lint, unit, integration and e2e all
> green, the happy path working against the seeded demo property, and the event
> log showing the transitions you expect. Update this file before you finish.

Two things that will save you an hour:

- **Run the suites against the LOCAL Postgres, not Railway.** The recipe is in
  Environment notes; the e2e suite times out against a remote database because
  Playwright's per-test default is 30s and one placement test makes a dozen page
  loads.
- **`docs/UI-WALKTHROUGH.md` is the fastest way to see what exists.** Every
  feature with the exact clicks, the logins, and snippets for the tables that
  have no screen yet (the folio). It is also the demo script.

### If you are picking a different thread

The three that are ready to start, in the order this file argues for:

1. **The rest of P3.5** — room types, QR reprint, staff and roles, property
   settings. Staff and roles is the biggest and the one a pilot needs first.
2. **Photo attachment**, the last P2 leftover — blocked with the rest of images
   on R2. The board reads `service_requests.photo_url`, `allows_photo` is
   editable and honoured, and nothing writes the column.
3. **The two P0/P1 leftovers**, both account-holder tasks rather than code: a git
   remote plus a Railway service, and then signing P1's exit criterion off on the
   deployed environment with a printed sticker on hotel wifi.
