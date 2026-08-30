import { execFileSync } from 'node:child_process';

/**
 * Reseed The Kesari before the suite runs.
 *
 * Not a convenience. These tests place orders, edit carts and answer the
 * verification prompt, and all three leave state behind:
 *
 *   - carts persist per stay (#10), so a run that fails mid-way leaves lines
 *     that make the next run's exact totals wrong;
 *   - `verification_challenges` counts failed attempts PER ROOM across
 *     challenges (DATA-MODEL §3), so the escalation test — which deliberately
 *     answers wrong once — locks its own room out after a few runs. That is
 *     the rate limiter working exactly as designed, and it made the suite pass
 *     only on the first run after a manual reseed.
 *
 * Reseeding makes every run start from the same place, and it is what CI does
 * anyway. It also guarantees `.demo-seed.json` matches the database the tests
 * are about to talk to.
 */
export default function globalSetup(): void {
  execFileSync('pnpm', ['demo:reset'], {
    stdio: process.env.CI ? 'inherit' : 'ignore',
    env: process.env,
  });
}
