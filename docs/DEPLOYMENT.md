# Deployment

What is in the repo, what has to be done once by hand, and how to tell whether
it worked. Read `docs/DECISIONS.md` D-024 and D-025 first — they say why the
pieces are arranged this way.

---

## What the repo already carries

| File | What it does |
|---|---|
| `Dockerfile` | Three stages. Ships the standalone server and its traced dependencies — no pnpm, no source, no migrations, no owner credentials. |
| `.dockerignore` | Keeps `.env` and `.demo-seed.json` out of the build context entirely. |
| `railway.json` | Dockerfile builder, `/api/health` as the healthcheck, restart on failure, one replica. |
| `.github/workflows/ci.yml` | `checks`, `integration` (Postgres 18 service container), `e2e` (Chromium + WebKit). Push to `main` and every PR. |
| `src/instrumentation.ts` | Drains the pool on SIGTERM so a deploy cannot cut a transaction mid-write. |

Verified locally, not just written: the image builds, runs against a Postgres
18 container, serves a scanned QR through to the room home **with CSS**, and
exits 0 on SIGTERM after draining the pool.

---

## The one-time setup (needs a human with the accounts)

### 1. GitHub

The repo has no remote yet. Create one, then:

```bash
git remote add origin git@github.com:<org>/<repo>.git
git push -u origin main
```

CI needs no secrets. Both suites run against a service container it starts
itself (D-024); nothing in the workflow touches Railway.

### 2. Railway — the app service

- New service in the existing project (the one already running Postgres),
  **Singapore region**, source = the GitHub repo, branch `main`.
- Railway reads `railway.json`, so the builder and healthcheck are already set.
- Variables:

  | Variable | Value |
  |---|---|
  | `DATABASE_URL` | `postgresql://app_user:…@postgres.railway.internal:5432/railway` |
  | `APP_URL` | the public domain Railway generates |
  | `SESSION_SECRET` | 32+ random bytes, generated once |
  | `NODE_ENV` | `production` |

  Use the **private** host (`postgres.railway.internal:5432`) — the public proxy
  is for laptops, costs egress, and adds latency to every query. Do **not** set
  `DATABASE_MIGRATION_URL` here; the app must not be able to reach Postgres as
  the owner (D-025).

- Generate a public domain. Nothing else needs configuring: the app binds
  `0.0.0.0:${PORT}` and every redirect uses a relative `Location`, so there is
  no host for the proxy to get wrong.

### 3. PR preview environments (optional)

Railway's PR environments each need their own Postgres and their own migration
run, which is the awkward part — a preview with an unmigrated database is a
container that boots and reports `degraded`. Worth it once there are reviewers;
not before.

---

## Deploying

A push to `main` builds and deploys. Railway holds the old container until
`/api/health` returns 200.

**If the push contains a migration, run it before or just after the deploy** —
from a laptop or from CI, with the owner URL:

```bash
DATABASE_MIGRATION_URL="postgresql://postgres:…@<host>.proxy.rlwy.net:<port>/railway" \
  pnpm db:migrate
```

Between the deploy and the migration, `/api/health` reports `degraded` and names
the pending files. That window is expected; the endpoint exists so it is visible
rather than discovered as a missing column.

---

## Verifying a deploy

```bash
curl -s https://<domain>/api/health | jq
```

```jsonc
{
  "status": "ok",          // "degraded" = migration drift; "down" = no database
  "version": "0.1.0",
  "commit": "c370d9a",     // matches the deployed commit
  "db": { "status": "up", "latencyMs": 3 },
  "migrations": { "applied": 4, "expected": 4, "pending": [], "unknown": [] }
}
```

- `pending` non-empty → the deploy is ahead of the schema. Run `pnpm db:migrate`.
- `unknown` non-empty → the container is *behind* the schema. Usually a rollback.
- `migrations: null` → the database is unreachable; the state is unknown, not
  "all pending".

Then the part no endpoint can tell you: **print a QR and scan it from a phone
on mobile data, not office wifi.** Seed the demo property against the deployed
database (`pnpm demo:reset` with `APP_URL` set to the public domain), print one
of the codes it prints, and scan it. That path crosses DNS, TLS, the Railway
proxy, a cellular NAT and iOS Safari — none of which a curl from a laptop
exercises.

---

## Logs

One JSON line per event, on stdout, collected by Railway. Every request-scoped
line carries `reqId`, the same value returned in the `x-request-id` response
header — so a guest quoting an id turns into one search.

```bash
railway logs | jq 'select(.reqId == "…")'
```

Locally, pipe through `pnpm exec pino-pretty` if you want colour. The app itself
never loads a pretty transport: it spawns a worker thread, and a worker inside a
Next.js server bundle is a class of problem this project does not need.
