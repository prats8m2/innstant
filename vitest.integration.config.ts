import { defineConfig } from 'vitest/config';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * These tests need DATABASE_URL and DATABASE_MIGRATION_URL, and nothing else in
 * the chain loads them: `pnpm test:integration` runs vitest directly, not
 * through `next` or `tsx --env-file`. So the suite failed with "DATABASE_URL is
 * not set" for anyone who had not exported it into their shell by hand.
 *
 * Loaded here, in the config, because Vitest forks its workers from this
 * process and they inherit its environment. Absent in CI, where the workflow
 * sets the two URLs directly — hence `-if-exists` semantics rather than a
 * hard require.
 */
if (existsSync('.env')) process.loadEnvFile('.env');

/**
 * Integration tests, separate from the unit config on purpose: these need a
 * real Postgres and must never be silently skipped when someone runs
 * `pnpm test`. A green unit suite that quietly omitted the isolation proofs is
 * exactly the false confidence S4 exists to prevent.
 */
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    // They share one database; parallel files would fight over fixtures.
    fileParallelism: false,
    // These run against a REMOTE database; a single test may make dozens of
    // round trips. 30s failed the lockout test for latency, not for a defect.
    testTimeout: 90_000,
    // Fixtures now run real provisioning against a REMOTE database. Even
    // batched that is a few seconds per tenant; a tight timeout here fails the
    // suite for latency rather than for a defect.
    hookTimeout: 180_000,
  },
});
