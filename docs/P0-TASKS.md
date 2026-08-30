# P0 — session by session

Ten sessions. One per Claude Code session, in this order. Each has a stated
done condition — don't move on until it holds.

Every session starts by reading `CLAUDE.md` and `docs/DECISIONS.md`. Say so in
the prompt; Claude Code will not reliably do it unprompted after the first turn.

---

## S1 · Scaffold and tooling

> Read CLAUDE.md and docs/DECISIONS.md.
>
> Scaffold the Next.js app. Requirements:
> - App Router, TypeScript strict, `output: 'standalone'` in next.config
> - Route groups `(guest)`, `(admin)`, `(ops)` as described in CLAUDE.md
> - Tailwind + shadcn/ui installed but NOT configured with default tokens —
>   leave the theme extension empty, S2 fills it
> - ESLint with a `no-restricted-imports` rule enforcing the module boundary:
>   `src/db/schema/<x>` is importable only from `src/modules/<x>/**` and
>   `src/db/**`. Add one deliberately failing example in a comment so I can
>   verify the rule fires.
> - Vitest with one passing unit test, Playwright with one passing smoke test
> - pnpm scripts exactly as listed in CLAUDE.md
> - `src/lib/money.ts` with minor-unit formatting: `₹1,150` Indian grouping,
>   tabular figures. Unit tests for 0, 100, 115000, and a negative.
>
> Do not build any UI or domain logic yet.

**Done when:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass
and the boundary lint rule demonstrably fires on a bad import.

---

## S2a · Extract the token system from the design export

The design lives in `design/reference/kesari-guest-app.html` — a **compiled**
Claude Design canvas bundle. It has no CSS custom properties; every colour is a
hardcoded hex inside a minified JS bundle. It cannot be read as a stylesheet and
its markup must never be copied into components.

This session's only job is to turn that bundle into `tokens.json`. Nothing else.

> Read design/README.md and design/design-prompts.md.
>
> Open `design/reference/kesari-guest-app.html` in a browser at 390×844 and
> read the computed styles. Produce:
> - `design/tokens/tokens.json` — the DEFAULT theme: colour, type scale,
>   spacing, radii, shadow, motion (duration + easing), image aspect ratios
>   (16:9 hero, 4:3 dish card, 1:1 thumb) and the scrim system.
> - `design/themes/kesari.json` — identical key set, The Kesari's values.
> - Fill in `design/reference/motion-notes.md`, which is currently a blank
>   template. The bundle is the only record of the motion system.
>
> Known starting points already read out of the bundle: `#101E33` deep indigo,
> `#E3E5DB` lime plaster, `#E9A227` saffron, `#6E9C95` teal, surfaces
> `#1B2B45` / `#16253E` / `#243755`; a 390×844 frame; `skeletonMs` default 620;
> a `lateNightMode` boolean. Verify each against the rendered page — do not
> trust this list.
>
> Every value you cannot determine from the export: list it explicitly and ask.
> Do not invent a type scale and present it as extracted.

**Done when:** `tokens.json` and `kesari.json` exist with identical key sets, and
every value traces to something observable in the export or to an answered
question. This is the one session where the export outranks the tokens — after
it, CLAUDE.md's rule applies permanently and the tokens win.

---

## S2b · Design tokens into the build

> Read CLAUDE.md and design/README.md.
>
> Wire the design token pipeline.
> - Write `design/tokens/tokens.schema.json` describing the token contract in
>   design/README.md, and validate the `tokens.json` produced in S2a against it
> - Write `scripts/build-tokens.ts` (`pnpm tokens:build`) that generates:
>   `src/styles/tokens.css` (CSS custom properties on :root),
>   the Tailwind theme extension, and `src/lib/theme/types.ts`
> - Generated files carry a "do not edit" header
> - A CI check that fails if generated output is stale
> - A `ThemeProvider` that applies a theme from `design/themes/*.json` by
>   setting CSS variables on `<html>` — this is the same mechanism that will
>   later read `properties.branding`
> - Self-host the fonts in `design/fonts/`, with `next/font/local`
>
> Then rebuild ONE screen from `design/reference/` — the room home — as a real
> component using only tokens. No hardcoded colours, radii, or durations.
> Treat the reference export as a picture, not as markup to copy.

**Done when:** the room home renders at token fidelity, and switching the theme
JSON changes its appearance with no component edits.

---

## S3a · Author the schema

**This session did not exist in the original plan, and its absence was the
biggest gap in P0.** S3 and S4 both open with "read `src/db/schema/*.ts`" — those
files have never existed. `docs/DATA-MODEL.md` is a rationale document: it names
roughly 40 of the 44 tables and defines columns for almost none of them.

This is the largest and riskiest session in P0. It gets its own branch.

> Read CLAUDE.md in full, docs/DATA-MODEL.md, and docs/EXTENSION-POINTS.md.
>
> Author the Drizzle schema — `src/db/schema/*.ts`, one file per module, per the
> layout in CLAUDE.md. Then `0001_rls.sql` and `0002_constraints.sql`.
>
> Non-negotiables that are schema-level, not code-level:
> - `tenant_id` on every tenant-scoped table; `property_id` wherever queries
>   filter on it (#1, D-004)
> - every amount is `*_minor` integer + a `currency` column on the same row (#5)
> - snapshot columns on all transactional lines (#6, DATA-MODEL §4)
> - `event_log` append-only; UPDATE and DELETE revoked from `app_user` (#7)
> - `UNIQUE (room_id) WHERE status = 'CHECKED_IN'` partial index (D-007)
> - `rooms.room_type_id` is an FK to a real `room_types` table — never a varchar
>   (EXTENSION-POINTS §1)
> - `guests` unique on `(tenant_id, phone)`, never `(property_id, phone)`
>   (EXTENSION-POINTS §2)
> - `stays.source` + `stays.source_ref_id` (EXTENSION-POINTS §3)
> - **no price column on `rooms`, ever** (#11, EXTENSION-POINTS §D)
> - none of the reserved names in #12 used for anything
> - the indexes in DATA-MODEL §9
>
> `0001_rls.sql` enables RLS on every tenant-scoped table with USING **and**
> WITH CHECK on `app.tenant_id`, and grants `app_user` the minimum it needs.
>
> Work in passes: propose the full table list first and let me review it against
> DATA-MODEL before you write a single column. Where DATA-MODEL is silent on a
> column, say so rather than inventing it silently.

**Done when:** the table list is reviewed and agreed, `pnpm db:generate` produces
a clean migration, and every invariant above is demonstrably present. No test
runs yet — S4 proves it.

---

## S3b · Database wiring

> Read CLAUDE.md, docs/DATA-MODEL.md and src/db/schema/*.ts.
>
> - Drizzle config pointing at src/db/schema
> - `pnpm db:generate` producing a clean initial migration from the schema
> - Migration runner using `DATABASE_MIGRATION_URL` (owner role), applying the
>   generated migration then `0001_rls.sql` and `0002_constraints.sql` in order
> - `src/db/client.ts`: a pool on `DATABASE_URL` (app_user, transaction pooler)
>   and the `withTenant()` helper exactly as specified in CLAUDE.md #1
> - `withTenant` must use `set_config(..., true)` inside an explicit
>   transaction. Never a bare SET.
> - A typed `Tx` export so domain services take a transaction, not the pool
>
> Nothing may query the database except through `withTenant`. Add an ESLint rule
> or a runtime guard — your call, but tell me which and why.

**Done when:** migrations apply cleanly against a fresh Railway Postgres and
`withTenant` returns rows for a manually inserted tenant.

---

## S4 · Prove the isolation

> Read CLAUDE.md #1–#3 and src/db/migrations/0001_rls.sql.
>
> Write integration tests, against a real Postgres, that prove:
> 1. Two tenants each with a property and rooms. A `withTenant(A)` read of
>    rooms returns only A's rows.
> 2. A raw pool query outside `withTenant` returns zero rows, not everything.
> 3. An INSERT under tenant A with tenant B's `tenant_id` is rejected by the
>    WITH CHECK policy.
> 4. `SET LOCAL` does not leak: two sequential requests through the pooler,
>    second one without setting the GUC, must see nothing.
> 5. `app_user` cannot UPDATE or DELETE `event_log`.
> 6. The one-active-stay-per-room partial unique index rejects a second
>    CHECKED_IN stay, tested with two concurrent inserts.
>
> These run in CI on every push. If any of them is awkward to write, that is a
> signal the design is wrong — tell me rather than weakening the test.

**Done when:** all six pass in CI. This is the most important session in P0.

---

## S5 · Staff auth and RBAC

> Read CLAUDE.md and src/db/schema/staff.ts.
>
> - Email + password auth for staff. Argon2id. httpOnly session cookie,
>   token hashed at rest.
> - Session carries tenantId and the set of propertyIds the user has roles at.
> - `authorize(session, propertyId, 'resource:action')` helper. One place.
>   Never inline permission checks in route handlers.
> - Seed the 8 system roles with `is_system = true`: PROPERTY_ADMIN,
>   FRONT_DESK, F_AND_B_MANAGER, KITCHEN, RUNNER, HOUSEKEEPING, CONCIERGE,
>   READ_ONLY. Propose the permission list for each and let me review before
>   you commit it.
> - Middleware that resolves the session and sets tenant/property context for
>   `/admin`, `/kds`, `/runner`.
>
> No password reset flow yet. No invites yet. Login and authorize only.

**Done when:** a FRONT_DESK user at property A gets a 403 on an admin-only
action at property A, and a 404 on anything at property B.

---

## S6 · Property provisioning and the demo seeder

> Read docs/DATA-MODEL.md section 10.
>
> - `provisionProperty()` in `modules/identity/` — ONE transaction creating:
>   property, the 8 roles, floors, rooms with room types, QR codes at version 1,
>   an IN_ROOM_DINING outlet with hours, ~20 seeded request types, a default
>   `access_policies` row, and the first PROPERTY_ADMIN invite.
> - `pnpm demo:reset` — truncate and reseed The Kesari: 34-key Udaipur haveli,
>   4 floors, 34 rooms across 3 room types, the menu from
>   design/design-prompts.md with real dishes and ₹ prices, 6 staff across
>   roles, 3 in-house stays, 2 in-flight orders at different states, 1 open
>   service request, and a partially populated folio.
> - The seeder prints the QR codes and staff logins to stdout.
> - It is idempotent and safe to run repeatedly.
>
> This function is also the integration-test fixture. Write it so tests can call
> it directly with an override object.

**Done when:** `pnpm demo:reset` runs twice in a row without error and prints a
working QR code.

---

## S7 · QR resolution, guest sessions, access tiers

> Read CLAUDE.md #9 and #10, docs/DECISIONS.md D-012, and
> src/db/schema/access.ts.
>
> - `/r/[code]` resolves publicCode → property, room, active CHECKED_IN stay.
>   Rejects a revoked or version-mismatched QR.
> - Issues an anonymous guest session at `access_policies.base_tier`
>   (default REQUEST). No verification screen. No login. This is the whole point
>   — read D-012 before you write a line of it.
> - `requireTier(session, 'CHARGE')` guard used by future ordering code.
>   When the tier is insufficient it triggers escalation, it does not 403.
> - Escalation flow: PHONE_LAST4 and OTP_SMS, rate limited per room and per
>   phone via `verification_challenges`. Attempts and abandonment recorded in
>   `access_escalations`.
> - Staff vouching endpoint writing `staff_vouches`, escalating the session
>   with zero guest-side interaction.
> - Sessions revoked on checkout. Tokens stored as SHA-256 only.
>
> Tests: a scan gives a working REQUEST session with no prompt; a CHARGE attempt
> triggers exactly one escalation; six wrong last-4 attempts lock out; a
> checked-out stay's session resolves to nothing.

**Done when:** you can scan a seeded QR on your phone, see the property home
with no screen in the way, and the session row shows `isAnonymous: true`,
`accessTier: REQUEST`.

---

## S8 · Deploy and CI

> - GitHub Actions: typecheck, lint, unit, integration (with a Postgres
>   service container), token freshness check. On every push.
> - Railway: `main` auto-deploys. PR preview environments if the plan allows.
> - `/api/health` returning app version, DB connectivity, and migration state.
> - Structured JSON logging with Pino, request id propagated.
> - Verify on the deployed environment, not locally: migrations applied,
>   `demo:reset` runnable against it, QR scan works from a phone on mobile data.

**Done when:** a push to main lands on Railway and a phone on 4G can scan a
printed QR and reach the room home.

---

## Then P1

Same pattern, from `docs/PROJECT-PLAN.md`. One task per session, done condition
stated in the prompt, and the invariants re-read at the top each time.
