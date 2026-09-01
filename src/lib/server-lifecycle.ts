/**
 * The Node-runtime half of `register()`. Split out of instrumentation.ts and
 * reached only through a dynamic import inside a `NEXT_RUNTIME === 'nodejs'`
 * check, because instrumentation.ts is compiled for BOTH runtimes — and an
 * edge build that can see `@/db` tries to bundle `pg`, which needs `fs`, and
 * fails. The check is what lets webpack drop this whole branch from the edge
 * bundle; an early `return` does not, since the import still resolves.
 */
import { logger } from '@/lib/logger';
import { closePool, closeNotifyConnection } from '@/db';
import { startSlaSweeper, stopSlaSweeper } from '@/modules/requests';

export function startLifecycle(): void {
  logger.info(
    {
      version: process.env.APP_VERSION ?? '0.0.0',
      commit: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      node: process.version,
    },
    'server started',
  );

  /**
   * The SLA sweep runs on a timer in this process (D-002 — it is a persistent
   * Node process, and D-022 removed the pooler that would have made a
   * long-running background transaction awkward). One instance sweeps at a time
   * through an advisory lock, so replicas are safe.
   *
   * Started here rather than from a route because a sweep triggered by traffic
   * stops escalating the moment a hotel goes quiet — which is exactly when a
   * forgotten request matters most.
   */
  startSlaSweeper();

  let shuttingDown = false;
  const shutdown = (signal: string) => async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down: draining the database pool');
    stopSlaSweeper();
    try {
      // The listener first: it holds an open connection and any SSE stream
      // feeding off it, and both should stop before in-flight writes finish.
      await closeNotifyConnection();
      await closePool();
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'pool did not drain cleanly');
    }
    process.exit(0);
  };

  process.on('SIGTERM', shutdown('SIGTERM'));
  process.on('SIGINT', shutdown('SIGINT'));
}
