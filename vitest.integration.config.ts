import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

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
