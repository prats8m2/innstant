# The deploy image. Railway builds this from `main`.
#
# Three stages so the thing that ships is the smallest possible: the runner
# carries the standalone server and its traced node_modules, and nothing else —
# no pnpm, no TypeScript, no source, no test suite.
#
# What is deliberately NOT in here: the migrations, `tsx`, and any way to reach
# the database as the owner role. The app image holds app_user credentials
# only. Migrations run separately, as the owner (CLAUDE.md #2, D-025) — and
# /api/health names the gap if a deploy gets ahead of them.

# ── deps ────────────────────────────────────────────────────────────────────
# Pinned exactly, not to a floating 22: a Node upgrade should be a commit.
FROM node:22.23.2-slim AS deps
WORKDIR /app

RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ── build ───────────────────────────────────────────────────────────────────
FROM node:22.23.2-slim AS build
WORKDIR /app

RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# src/db refuses to load without DATABASE_URL — correctly, since a process that
# reaches Postgres as the wrong role is worse than one that will not start.
# Nothing connects during a build; this only has to parse.
ENV DATABASE_URL=postgres://app_user:build@localhost:5432/build_only
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ── runner ──────────────────────────────────────────────────────────────────
FROM node:22.23.2-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# `pnpm build` runs bundle:static, so .next/standalone already contains
# .next/static and public — standalone does not copy them itself, and without
# that step the app serves HTML with no CSS. That was a real debugging round.
COPY --from=build /app/.next/standalone ./

# Not root. Next's own image ships this user; using it means the writable
# surface inside the container is nothing that matters.
USER node

EXPOSE 3000

# No shell wrapper: the process must receive SIGTERM directly, or the pool
# drain in src/instrumentation.ts never runs and Railway kills transactions
# mid-write on every deploy.
CMD ["node", "server.js"]
