/**
 * Every validation this project has, as data.
 *
 * The page can run what is in this list and nothing else. A run request names
 * an `id`; the server looks it up here and spawns the `argv` recorded against
 * it. No command is ever assembled from anything a request sends — that is
 * the whole reason this is a table rather than a `POST /run?cmd=`.
 *
 * `proves` is the part worth maintaining. A dashboard of green ticks that
 * nobody can read a meaning into is decoration; what makes a gate worth the
 * seconds it costs is knowing which specific promise goes dark when it fails.
 */

export type CheckId =
  | 'typecheck' | 'lint' | 'unit' | 'build' | 'integration' | 'e2e';

export type Group = 'gate' | 'deep';

export interface Runnable {
  id: CheckId;
  label: string;
  group: Group;
  /** Shown in the UI. Kept in step with `argv` by hand — they are one line apart. */
  command: string;
  /** What is actually spawned. Never built from request input. */
  argv: readonly string[];
  /** One line: what a green here actually guarantees. */
  proves: string;
  /** A precondition this cannot satisfy for itself. */
  needs?: string;
  /**
   * Set when the check WRITES to the database it connects to.
   *
   * The page names the target host beside such a row and asks before
   * queueing it. Running the integration suite against a production
   * DATABASE_URL provisions test tenants into it, and a button is a much
   * easier thing to press by accident than a command is to type.
   */
  writes?: boolean;
  env?: Readonly<Record<string, string>>;
  /**
   * Files the command rewrites as a side effect and which must be put back.
   * `next build` edits `next-env.d.ts` and `tsconfig.json` to point at
   * whichever `distDir` it used — running a check must not leave the worktree
   * dirty, or the next `git status` blames the person who pressed the button.
   */
  restores?: readonly string[];
  /** Pulls a one-line summary out of the output. */
  summarise?: (output: string) => string | null;
}

/**
 * Vitest's tallies, shortened to the part worth putting in a row.
 *
 * "Tests 370 passed (370) / Test Files 31 passed (31)" is four numbers
 * saying one thing, and the row already says "passed" beside it. A failing
 * run is the opposite case — there the breakdown IS the news, so it is kept
 * verbatim.
 */
function vitestSummary(out: string): string | null {
  const tests = /^\s*Tests\s+(.+?)\s*$/m.exec(out)?.[1]?.trim();
  const files = /^\s*Test Files\s+(.+?)\s*$/m.exec(out)?.[1]?.trim();
  if (!tests) return null;
  if (/failed/i.test(tests)) return tests;
  const total = /\((\d+)\)$/.exec(tests)?.[1];
  const fileTotal = files ? /\((\d+)\)$/.exec(files)?.[1] : undefined;
  if (!total) return tests;
  return fileTotal ? `${total} tests · ${fileTotal} files` : `${total} tests`;
}

export const RUNNABLES: readonly Runnable[] = [
  {
    id: 'typecheck',
    label: 'Types',
    group: 'gate',
    command: 'pnpm typecheck',
    argv: ['pnpm', '-s', 'typecheck'],
    proves:
      'Every type in the repo lines up, including the route types Next generates '
      + 'from the app directory — which is how a renamed param is caught.',
  },
  {
    id: 'lint',
    label: 'Lint & module boundaries',
    group: 'gate',
    command: 'pnpm lint',
    argv: ['pnpm', '-s', 'lint'],
    proves:
      'No module imports another module\'s tables, nothing outside src/db opens a '
      + 'second pool, and nothing but modules/stay touches `stays` (D-001, '
      + 'CLAUDE.md #1 and #4).',
  },
  {
    id: 'unit',
    label: 'Unit tests',
    group: 'gate',
    command: 'pnpm test',
    argv: ['pnpm', '-s', 'test'],
    proves:
      'Every state-machine transition and every money calculation, plus the theme '
      + 'discipline rules — no raw hex, no per-component reduced-motion block — and '
      + 'WCAG contrast on the palette.',
    summarise: vitestSummary,
  },
  {
    id: 'build',
    label: 'Production build',
    group: 'gate',
    command: 'pnpm build',
    argv: ['pnpm', '-s', 'build'],
    proves:
      'The standalone server compiles and every route is classified static or '
      + 'dynamic as intended.',
    /**
     * Its own distDir, always.
     *
     * A build into `.next` while a dev server is watching it corrupts that
     * server — it has cost this project a session before, and a button is far
     * easier to press by accident than a command is to type.
     */
    env: { NEXT_DIST_DIR: '.next-quality' },
    restores: ['next-env.d.ts', 'tsconfig.json'],
  },
  {
    id: 'integration',
    label: 'Integration tests',
    group: 'deep',
    command: 'pnpm test:integration',
    argv: ['pnpm', '-s', 'test:integration'],
    needs: 'a reachable Postgres — it runs against a real database, not a mock',
    writes: true,
    proves:
      'Cross-tenant reads return nothing under real RLS, WITH CHECK holds on '
      + 'INSERT and UPDATE, tenant context does not leak across pooled '
      + 'connections, event_log is append-only, and the concurrency paths elect '
      + 'exactly one winner.',
    summarise: vitestSummary,
  },
  {
    id: 'e2e',
    label: 'End-to-end',
    group: 'deep',
    command: 'pnpm test:e2e',
    argv: ['pnpm', '-s', 'test:e2e'],
    needs: 'Playwright browsers installed, and a seeded demo property',
    proves: 'A scan-to-order journey works in a real browser against the seeded hotel.',
  },
] as const;

export const byId = (id: string): Runnable | undefined =>
  RUNNABLES.find((r) => r.id === id);
