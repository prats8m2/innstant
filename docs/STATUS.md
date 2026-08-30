# Status

**Read this after `CLAUDE.md`, at the start of every session.** It is the
handoff between sessions — where the work is, what is next, and what is
blocked.

Run **`pnpm status`** first. This file states intent; that command states
verified fact (which commit, whether the gates pass, whether the database is
reachable and correctly configured). If the two disagree, the command is right
and this file is stale — fix it.

**Keep this current.** At the end of a session: move the finished session into
Done, rewrite `## Now`, and append anything learned to Environment notes. A
stale status file is worse than none.

---

## Now

**P0 · Foundation. S3a is IN PROGRESS and paused at its review gate.**

`docs/SCHEMA-PROPOSAL.md` holds the proposed 51-table list and **seven open
decisions**. Nothing may be written into `src/db/schema/` until those are
answered — that is S3a's stated done condition, and decision 3 (who owns
`event_log`) is a genuine conflict between CLAUDE.md #7 and D-001 that must be
resolved rather than worked around.

After the review: write the schema, then `0001_rls.sql` and
`0002_constraints.sql`, then S3b.

S2a (extract design tokens from `design/reference/kesari-guest-app.html`) is
independent and can be done in parallel. Neither needs the database.

---

## Done

| Session | Commit | What landed |
|---|---|---|
| — | `9fba2a4` | Docs reconciled with filesystem. DATA-MODEL §3 rewritten to match D-012. `modules/tenancy` → `modules/identity`. P0 split into 10 sessions (added S2a, S3a). git init. |
| S1 | `57be712` | Next.js App Router scaffold, TS strict, `output: 'standalone'`. Route groups, `/api/health`. Module-boundary ESLint rule + 7 probe tests. `src/lib/money.ts` + 20 tests. Vitest + Playwright. Node pinned to 22. |

---

## Blocked / open questions

- **PgBouncer does not exist yet.** CLAUDE.md #3 assumes transaction pooling.
  Railway Postgres is a direct connection on the TCP proxy port. `set_config(...,
  true)` inside an explicit transaction is correct either way, so this does not
  block S3b — but **S4's `SET LOCAL` leak test is not meaningful until a real
  pooler is in front of the database.** Decide before S4: add PgBouncer as a
  Railway service, or amend #3 and record it as a superseding decision.
- **Fonts are not chosen or licensed.** `design/fonts/` is empty. A hotel
  deployment is commercial use — the licence has to be checked and the LICENCE
  file committed next to each `.woff2`. Blocks the end of S2b.
- **No pilot property identified.** PROJECT-PLAN optimises for the P1 demo,
  which is right, but if a real hotel is already interested, the four
  objection-killers in P5 (CSV menu import, QR print sheets, WhatsApp alerts,
  daily digest) should be pulled forward. Product decision, not a code one.

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
- The design export is a **compiled** Claude Design bundle with zero CSS custom
  properties. Tokens must be read off the rendered page, not grepped out.

---

## How to resume in a new session

Paste this:

> Read `CLAUDE.md`, `docs/STATUS.md`, and `docs/DECISIONS.md`. Then run
> `pnpm status`. We are on P0. Pick up at the session named in `## Now` and
> follow its prompt in `docs/P0-TASKS.md` exactly — including its stated done
> condition. Do not start the next session until that condition holds.
