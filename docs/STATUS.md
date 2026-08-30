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

**P0 · Foundation. S6 is COMPLETE.** 58 unit + 47 integration tests green;
typecheck, lint, build clean. `pnpm demo:reset` runs repeatedly and prints
working QR codes.

**Next: S7 — QR resolution, guest sessions, access tiers.**
`docs/P0-TASKS.md` has the prompt. **Read D-012 and CLAUDE.md #9 and #10 before
writing a line of it** — this is the session most likely to be built wrong,
because the obvious implementation (verify on scan) is the one that was
explicitly rejected.

What S7 must produce:
- `/r/[code]` resolves publicCode → property + room + active CHECKED_IN stay,
  rejecting a revoked or version-mismatched QR
- an anonymous session at `access_policies.base_tier` (REQUEST) with **no
  verification screen** — `guest_sessions.isAnonymous = true`
- `requireTier(session, 'CHARGE')` that ESCALATES rather than 403s
- escalation via PHONE_LAST4 / OTP_SMS, rate limited per room and per phone
- staff vouching, writing `staff_vouches`, with zero guest-side interaction
- sessions revoked at checkout; tokens SHA-256 only

Then **S8** (deploy + CI) and **S2a** (design tokens — still unstarted, still
independent of everything else).

**Still not in CI.** Nothing re-runs any suite on push. That is S8, and until it
exists the suites are only as good as someone remembering to run them.

**To resume, run `pnpm demo:reset` first** — it prints a live QR URL and the
staff logins, which is the fastest way to see the current state of the product.

## Done

| Session | Commit | What landed |
|---|---|---|
| — | `9fba2a4` | Docs reconciled with filesystem. DATA-MODEL §3 rewritten to match D-012. `modules/tenancy` → `modules/identity`. P0 split into 10 sessions (added S2a, S3a). git init. |
| S1 | `57be712` | Next.js App Router scaffold, TS strict, `output: 'standalone'`. Route groups, `/api/health`. Module-boundary ESLint rule + 7 probe tests. `src/lib/money.ts` + 20 tests. Vitest + Playwright. Node pinned to 22. |
| — | `48dd194` | `docs/STATUS.md` + `pnpm status` — the cross-session resume mechanism. |
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

---

## How to resume in a new session

Paste this:

> Read `CLAUDE.md`, `docs/STATUS.md`, and `docs/DECISIONS.md`. Then run
> `pnpm status`. We are on P0. Pick up at the session named in `## Now` and
> follow its prompt in `docs/P0-TASKS.md` exactly — including its stated done
> condition. Do not start the next session until that condition holds.
