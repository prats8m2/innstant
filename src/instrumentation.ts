/**
 * Runs once, in the server process, before the first request. Next.js calls
 * `register()` on boot.
 *
 * This exists because the app is a persistent Node process (D-002), not a
 * serverless function: it has a lifecycle, and something has to own the two
 * ends of it. On SIGTERM — exactly what Railway sends before replacing a
 * container — the pool is drained so in-flight transactions finish instead of
 * being cut mid-write. A deploy during dinner service must not abort a
 * transaction between an order's status change and its event_log row, which is
 * the one pairing CLAUDE.md #7 exists to keep atomic.
 *
 * This file is compiled for BOTH runtimes, so the real work lives behind the
 * runtime check below — see the note in src/lib/server-lifecycle.ts.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startLifecycle } = await import('@/lib/server-lifecycle');
    startLifecycle();
  }
}
