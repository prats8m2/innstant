# Hotel guest services platform

Multi-tenant guest-services software for hotels. A guest scans a QR code on the
nightstand and can order food, request amenities, call a staff member, manage
their checkout, and browse nearby places — with no app install, no signup, and
no login screen. Staff run all of it from an admin panel, a kitchen display, and
a runner app.

Booking is deliberately **not** in scope. See `docs/EXTENSION-POINTS.md`.

## Start here

| Read | For |
|---|---|
| `CLAUDE.md` | the invariants. Read first, every session. |
| `docs/STATUS.md` | where the work is right now — plus `pnpm status` |
| `docs/DECISIONS.md` | why the codebase is shaped this way |
| `docs/PROJECT-PLAN.md` | the six phases and their exit criteria |
| `docs/P0-TASKS.md` | the current phase, session by session |
| `docs/DATA-MODEL.md` | the schema's reasoning |
| `docs/EXTENSION-POINTS.md` | the seams that keep v2 booking cheap |
| `design/README.md` | how design reaches the code |

## Surfaces

- **Guest PWA** — `/r/[qrCode]`. Mobile only.
- **Ops console** — `/admin`. Desktop, RBAC-heavy.
- **Kitchen & floor** — `/kds`, `/runner`. Always-on tablet and phone.

## Stack

Next.js App Router (`output: 'standalone'`, persistent Node process) ·
TypeScript strict · PostgreSQL + Drizzle · Zod at every boundary ·
Tailwind + shadcn/ui on overridden tokens · Framer Motion ·
Postgres `LISTEN/NOTIFY` → SSE · Railway (Singapore) · Cloudflare R2 · Razorpay

## Setup

```bash
cp .env.example .env      # fill in — see the note on roles below
pnpm install
pnpm db:migrate
pnpm demo:reset           # seeds The Kesari, prints QR codes + staff logins
pnpm dev
```

**Two database roles, on purpose.** `DATABASE_URL` connects as `app_user`, which
owns no tables and lacks `BYPASSRLS` — this is what makes row-level security real
rather than decorative. `DATABASE_MIGRATION_URL` connects as the owner and is
used only by `pnpm db:migrate`. Pointing `DATABASE_URL` at the owner role
silently disables every tenant-isolation guarantee in the product. See
CLAUDE.md #2.

## Commands

```bash
pnpm status       # verified state: gates, database, current session
pnpm dev          pnpm build        pnpm typecheck    pnpm lint
pnpm test         pnpm test:e2e
pnpm db:generate  pnpm db:migrate   pnpm db:studio
pnpm tokens:build pnpm demo:reset
```

## Status

**P0 · Foundation — in progress.** Nothing is demoable yet; see
`docs/P0-TASKS.md` for the session order. The demo milestone is the end of P1.

Demo data is always seeded and resettable — never real guest data (D-018).
