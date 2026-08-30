import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { pingDatabase, readMigrationState } from '@/db';
import { REQUEST_ID_HEADER, newRequestId } from '@/lib/request-id';
import { requestLogger } from '@/lib/logger';

/**
 * Health check. A Route Handler, not a Server Action — Railway and uptime
 * monitoring call this, and those are third parties (CLAUDE.md "Conventions").
 *
 * ─── What the HTTP status means ────────────────────────────────────────────
 *
 * 503 means "do not send this process traffic". Only the database being
 * unreachable earns it: a process that cannot open a connection cannot serve a
 * menu, and Railway should hold the old container.
 *
 * A pending migration does NOT earn a 503, deliberately. It is reported as
 * `status: "degraded"` with the file names, on a 200. Failing the health check
 * on drift would deadlock the ordinary deploy order — the new container has to
 * be up and healthy before `pnpm db:migrate` runs against it — and would turn
 * a visible, nameable problem into a container that never starts and says why
 * only in a log. Alert on `degraded`; do not route on it.
 */
export const dynamic = 'force-dynamic';

const expected = (process.env.APP_MIGRATIONS ?? '').split(',').filter(Boolean);

export async function GET(): Promise<NextResponse> {
  const reqId = (await headers()).get(REQUEST_ID_HEADER) ?? newRequestId();
  const log = requestLogger(reqId, { route: '/api/health' });

  const [db, migrations] = await Promise.all([pingDatabase(), readMigrationState()]);
  const applied = migrations?.names ?? [];
  const pending = expected.filter((name) => !applied.includes(name));

  // A file the database has run but this build does not know about means the
  // container is older than the schema — a rollback, usually. Worth naming.
  const unknown = applied.filter((name) => !expected.includes(name));

  const healthy = db.ok && pending.length === 0 && unknown.length === 0;

  const body = {
    status: db.ok ? (healthy ? 'ok' : 'degraded') : 'down',
    version: process.env.APP_VERSION ?? '0.0.0',
    commit: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    uptimeSeconds: Math.round(process.uptime()),
    requestId: reqId,
    db: {
      status: db.ok ? 'up' : 'down',
      latencyMs: db.latencyMs,
    },
    migrations: migrations
      ? {
          applied: applied.length,
          expected: expected.length,
          latest: applied.at(-1) ?? null,
          appliedAt: migrations.appliedAt?.toISOString() ?? null,
          pending,
          unknown,
        }
      : // No __drizzle_migrations table at all: never migrated, or connected to
        // the wrong database entirely.
        { applied: 0, expected: expected.length, latest: null, appliedAt: null, pending: expected, unknown: [] },
  };

  if (!db.ok) log.error({ health: body }, 'health check failed: database unreachable');
  else if (!healthy) log.warn({ pending, unknown }, 'health check degraded: migration drift');

  return NextResponse.json(body, {
    status: db.ok ? 200 : 503,
    headers: { [REQUEST_ID_HEADER]: reqId, 'cache-control': 'no-store' },
  });
}
