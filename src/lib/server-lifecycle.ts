/**
 * The Node-runtime half of `register()`. Split out of instrumentation.ts and
 * reached only through a dynamic import inside a `NEXT_RUNTIME === 'nodejs'`
 * check, because instrumentation.ts is compiled for BOTH runtimes — and an
 * edge build that can see `@/db` tries to bundle `pg`, which needs `fs`, and
 * fails. The check is what lets webpack drop this whole branch from the edge
 * bundle; an early `return` does not, since the import still resolves.
 */
import { logger } from '@/lib/logger';
import { closePool } from '@/db';

export function startLifecycle(): void {
  logger.info(
    {
      version: process.env.APP_VERSION ?? '0.0.0',
      commit: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      node: process.version,
    },
    'server started',
  );

  let shuttingDown = false;
  const shutdown = (signal: string) => async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down: draining the database pool');
    try {
      await closePool();
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'pool did not drain cleanly');
    }
    process.exit(0);
  };

  process.on('SIGTERM', shutdown('SIGTERM'));
  process.on('SIGINT', shutdown('SIGINT'));
}
