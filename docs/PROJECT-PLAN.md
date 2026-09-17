# Project plan

Six phases. Each has an exit criterion — a thing that either works or doesn't.
Do not start the next phase until the current one's exit criterion passes on the
deployed environment, not just locally.

**The demo milestone is the end of P1.** Everything before that is scaffolding
nobody can see; everything after is expansion. Optimise for reaching P1.

---

## P0 · Foundation — 2 weeks

Nothing here is demoable. All of it is expensive to retrofit.

**Repo & tooling**
- [x] Next.js App Router, TypeScript strict, `output: 'standalone'`
- [x] Tailwind + shadcn/ui installed, tokens overridden from `design-tokens.json`
- [x] ESLint with the module-boundary `no-restricted-imports` rule
- [x] Vitest + Playwright wired, one passing test each
- [ ] GitHub → Railway auto-deploy on `main`, preview env on PR
      **— the only P0 item outstanding. The Dockerfile, `railway.json` and the CI
      workflow exist and are verified locally; there is no git remote and no
      Railway app service. Account-holder task.**

**Database**
- [x] Drizzle config, schema files from `src/db/schema/` generating cleanly
- [x] Migration runner using the migration role (not `app_user`)
- [x] `0001_rls.sql` and `0002_constraints.sql` applied
- [x] `withTenant()` helper + a test proving a cross-tenant read returns nothing
- [x] A test asserting the tenant context does not leak between two sequential
      requests that reuse the same pooled connection (no PgBouncer — D-022;
      node-postgres reuses connections, so the leak is still possible)

**Identity & access**
- [x] Staff auth: email + password, session cookie
- [x] The 8 system roles seeded, `authorize()` helper on `resource:action`
- [x] `provisionProperty()` — one transaction, creates property, roles, floors,
      rooms, QR codes, an outlet, and ~20 request types
- [x] QR resolution: `/r/[code]` → property + room + active stay
- [x] Access tiers + `access_policies`, default policy row on provisioning
- [x] Guest session issue / escalate / revoke, tokens hashed

**Exit criterion:** two properties exist in one database; a staff user at
property A cannot read a single row belonging to property B, proven by a test
that tries. A QR scan on a seeded room resolves to a live stay and issues a
`REQUEST`-tier session with no verification screen.

---

## P1 · In-room dining, end to end — 4–5 weeks

This is the whole product in miniature: catalog, transaction, realtime, two
roles. It is also the demo.

**Catalog (ops)**
- [x] Outlet CRUD with hours, fees, tax rates *(edit only — a second outlet is
      created by `provisionProperty()`, not from a screen)*
- [x] Menu category and item CRUD
- [ ] Image upload → R2, enforced aspect ratio, blurhash generated **— blocked:
      R2 is not configured. The dish form takes a URL into the same column, and
      placement snapshots it.**
- [x] Modifier groups, reusable across items
- [x] Availability toggle + scheduled windows
- [x] Editorial collections

**Guest ordering**
- [x] Menu browse: sticky category rail, collections, dish cards
- [x] Dish detail with modifiers, quantity, notes
- [x] Server-side cart keyed to `(stay, outlet)`
- [x] Totals: subtotal, tax, service charge, delivery fee, tip
- [x] Place order — idempotent, snapshotted, folio line posted
- [x] Access escalation on first charge (the one verification prompt)
- [x] Live order tracking via SSE

**Kitchen**
- [x] KDS ticket rail per outlet, oldest first
- [x] Audible alert + persistent unacknowledged count
- [x] Accept / reject with reason
- [x] Bump preparing → ready, prep timers with colour ageing
- [x] Mark an item unavailable from the KDS
- [x] Runner pickup queue, mark delivered

**Plumbing**
- [x] `LISTEN/NOTIFY` → SSE fan-out, reconnect handling
- [x] Order state machine with every transition writing `event_log`
- [x] `demo:reset` seeder producing The Kesari with realistic data

**Exit criterion:** on the deployed Railway environment, scan a printed QR with a
real phone, order three dishes with modifiers, watch the ticket appear on a
second device within two seconds, bump it through to delivered, and see the
charge on the folio. Do this on hotel-grade wifi, not your desk.

**Status: the whole chain passes on localhost against a docker Postgres, in one
automated test across three devices — 379ms from Send to the ticket, and
delivered by a runner. What it has NOT been done on is Railway, a printed
sticker, and hotel wifi. That is the one thing between P1 and done, and it needs
a git remote and a Railway app service first (see P0's last item).**

---

## P2 · Amenities & service requests — 3 weeks

- [ ] Request-type catalog admin: SLA, price, routing role, quantity rules
- [x] Guest amenity browse — free and chargeable in one list
- [x] One-tap service call with live "on the way" state
- [x] Text note · **[ ] photo attachment** — the column and the per-type rule are
      wired; uploading is blocked with the rest of images (R2)
- [x] Request state machine + event log
- [x] Auto-routing: role ∩ on-shift ∩ covers floor, ranked by open count
- [x] SLA worker: sweep, escalate, notify duty manager *(the notification is a
      row; nothing delivers it yet — the channel needs an external service)*
- [x] Housekeeping board with SLA countdowns
- [x] Runner/housekeeping mobile view *(the board IS the mobile view — one
      column, phone-first; a dedicated runner variant can come with routing)*
- [x] Shifts, clock in/out, floor zone assignment *(clocked from the board; a
      rota that schedules them ahead is P5 work)*

**Exit criterion:** a request raised by a guest reaches the correct on-duty staff
member's phone without anyone assigning it, and breaches visibly escalate.

**Status: met, with one honest asterisk.** Clocked in for a floor, a housekeeper
gets the request already assigned and the guest reads their name, with nobody
tapping anything (`tests/e2e` · "routing a request to whoever is on duty"). A
request that misses its promise escalates on a 60-second timer, the board says
"Manager told", and a notification row is written for the duty manager — proven
against the running server, not only in tests.

The asterisk: nothing DELIVERS that row. "Notify the duty manager" means a row
in `notifications` today, which a screen or a WhatsApp drainer turns into an
actual interruption. That is the last P2 item and it needs an external service,
which CLAUDE.md says to ask about.

---

## P3 · Stay & folio — 3 weeks

- [ ] Guest folio view, tabular figures
- [ ] Late checkout / extend / early checkout request flow with fee tiers
- [ ] Front-desk approve, decline, override fee
- [ ] Approval mutates `scheduled_checkout_at`; sessions follow
- [ ] Express checkout with Razorpay
- [ ] Folio settle, digital receipt, email on settlement
- [ ] `PmsAdapter` interface + `ManualAdapter`
- [ ] `integration_outbox` + drain worker
- [ ] Front desk: room list, check in/out, guest 360

**Exit criterion:** a stay goes from check-in through three chargeable
interactions to a settled folio, and every line reconciles to a payment.

---

## P3.5 · Running the property — 2 weeks

**Not in the original six phases, and that was a gap rather than a decision.**
The plan covers the guest-facing product and its daily operation; it never
covered a hotel setting itself up. P0 made `provisionProperty()` correct and
transactional and its exit criterion was about ISOLATION — "two properties exist
in one database" — never about a human creating the second one. P1 said so out
loud for outlets: *"a second outlet is created by `provisionProperty()`, not from
a screen"*, and the same was quietly true of floors, rooms, staff and settings.

The measure of the gap: **21 of 55 declared permissions had no caller anywhere**
when this phase was written. Three are P4's concierge. The rest are this.

A GM cannot add their night manager, add a room, reprint a damaged QR sticker, or
change the hotel's name. That is fine for a demo and fatal for a pilot — it is
the first thing a real hotel asks for, and P5's exit criterion is a real hotel
running on this for two weeks.

- [ ] **Floors and rooms** — add, rename, archive. A room added here mints its QR
      code, or it is a room no sticker reaches. Archiving is refused while a
      floor holds rooms or a room holds an active stay
      *(`room:read`, `room:manage`)*
- [ ] **Room types** — the dropdown `rooms` already points at. Never a price
      (#11) *(`room:manage`)*
- [ ] **QR reprint** — bump `version`, revoke the old code, next to the Copy link
      that already exists on the room row. The one operation that invalidates
      something physically on a nightstand *(`qr:regenerate`)*
- [ ] **Staff and roles** — invite, edit, deactivate, assign a role at a
      property. `provisionProperty()` creates exactly one PROPERTY_ADMIN as
      INVITED with no password, and S5 never built the invite flow, so a second
      staff member is currently a seeder run
      *(`staff:*`, `role:read`, `role:assign`)*
- [ ] **Property settings** — name, timezone, currency, address. `branding` is
      the theme editor and stays in P5 *(`property:update`)*

**Deliberately NOT in this phase:**

- **Client onboarding** — creating a tenant is above the tenant boundary. Every
  page runs inside `withTenant()` and a screen that creates tenants cannot, by
  definition. It needs a decision about how a platform operator authenticates,
  and that changes the tenancy model — CLAUDE.md says ask first. `provisionTenant()`
  and `provisionProperty()` remain the way, called from a script.
- **The rota** (`shift:manage`) — P5 already owns it: *"a rota that schedules
  them ahead is P5 work"*.
- **`folio:read`, `payment:read`, `order:dispute`, `stay:update`** — money and
  stay reads that belong to screens P3 built or P5 will. `folio:read` was the
  one real bug the sweep found: the guest 360 page showed a folio behind
  `guest:read`, which CONCIERGE holds and `folio:read` deliberately is not.

**Exit criterion:** a GM who has never seen a seeder can add a floor, put three
rooms on it, print their stickers, and give the new night manager a login — and a
guest scans one of those stickers and orders dinner.

---

## P4 · Concierge — 2–3 weeks

- [ ] POI admin with editorial note, partner flag, offer
- [ ] Guest browse by category, distance and travel time primary
- [ ] Open in Maps
- [ ] Day itinerary builder, reorder, custom stops
- [ ] Nightly distance/travel-time refresh job

**Exit criterion:** a GM can add a restaurant with their own one-line note in
under a minute, and it appears correctly ordered by walk time.

---

## P5 · Hardening & pilot — 3 weeks

- [ ] Analytics: order value per stay, SLA breach rate, top items, response times
- [ ] Multi-language, per-item translations
- [ ] Post-stay feedback + NPS
- [ ] Theme editor with WCAG AA validation at save
- [ ] Rate limiting on all public endpoints
- [ ] Perf: LCP under 2s on mid-range Android over hotel wifi
- [ ] Accessibility pass
- [ ] Menu import from CSV, QR print sheet generation
- [ ] WhatsApp staff alerts (removes "another app to install" objection)
- [ ] Daily digest email so the GM never has to log in

**Exit criterion:** one real hotel floor runs on it for two weeks and the F&B
manager asks for the second floor.

---

## Sequencing notes

**Do P0 completely.** Every item in it is either a tenancy invariant or a test
that proves one. They are all cheap now and expensive after there's data.

**Ship P1 to one real floor before starting P2.** Everything you learn about
wifi dead zones, how staff actually hold the tablet, and what the kitchen does
when two orders land at once will rewrite your P2 assumptions. Building P2 first
means building it twice.

**P3 before P4.** Money is a harder sale to get wrong than concierge content, and
the folio is what makes the GM trust the system.

**P3.5 before P4, and before any pilot.** It was not in the original six phases
at all — the plan covered the product and never covered a hotel setting itself
up. A hotel that cannot add a staff member or a room cannot run the two-week
pilot P5's exit criterion asks for, and concierge content is worth nothing to a
hotel that cannot give its concierge a login.

**The four features that kill the "extra effort" objection** are in P5 and feel
unglamorous: CSV menu import, QR print sheets, WhatsApp alerts, daily digest.
Pull any of them forward if a prospect raises the objection — they are worth more
in a sales conversation than another guest-facing feature.

---

## Working with Claude Code on this

One phase per branch. Within a phase, one task per session — long sessions drift
from the invariants in `CLAUDE.md`.

Good opening prompt shape:

> Read CLAUDE.md, docs/DECISIONS.md and docs/PROJECT-PLAN.md. We're on P1.
> Implement the server-side cart: `modules/ordering/cart.ts` plus the server
> actions for add/update/remove. One cart per (stay, outlet), stored in the
> `carts` table. Follow the withTenant and Zod conventions. Write the tests
> first, including one for two concurrent adds to the same cart.

Bad opening prompt: "build the ordering module". The invariants get lost around
the third file.

After any schema change, make it update `docs/DATA-MODEL.md` in the same commit.
After any significant decision, make it append to `docs/DECISIONS.md`.
