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
- [x] One-tap service call · **[ ] live "on the way" state** — the screen shows
      the status it was rendered with; SSE on the request channel is next
- [x] Text note · **[ ] photo attachment** — the column and the per-type rule are
      wired; uploading is blocked with the rest of images (R2)
- [x] Request state machine + event log
- [ ] Auto-routing: role ∩ on-shift ∩ covers floor, ranked by open count
- [ ] SLA worker: sweep, escalate, notify duty manager
- [ ] Housekeeping board with SLA countdowns
- [ ] Runner/housekeeping mobile view
- [ ] Shifts, clock in/out, floor zone assignment

**Exit criterion:** a request raised by a guest reaches the correct on-duty staff
member's phone without anyone assigning it, and breaches visibly escalate.

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
