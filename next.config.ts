import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NextConfig } from 'next';

/**
 * Two values are baked in at build time rather than read at runtime, because
 * `output: 'standalone'` ships a tree that contains neither package.json nor
 * src/db/migrations — a runtime read would work locally from the repo root and
 * return nothing at all inside the deployed image, which is the worst kind of
 * difference.
 *
 *   APP_VERSION     — what /api/health reports.
 *   APP_MIGRATIONS  — the migration files this build EXPECTS to be applied.
 *                     /api/health compares it against what the database says
 *                     and names the difference, so "the deploy is live but
 *                     db:migrate was never run" is one request to diagnose
 *                     instead of a column-does-not-exist error at 9pm.
 */
const version = (JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
  version: string;
}).version;

const migrations = readdirSync(join(process.cwd(), 'src/db/migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .join(',');

const nextConfig: NextConfig = {
  /**
   * Where the build goes.
   *
   * Overridable because `next dev` and `next build` share `.next`, and a build
   * run while a dev server is watching it leaves BOTH broken: the dev server
   * starts 500ing on a missing vendor chunk, and the next build fails with
   * `PageNotFoundError: Cannot find module for page: /admin`. Neither error
   * names the real cause.
   *
   * `NEXT_DIST_DIR=.next-e2e pnpm test:e2e` therefore builds somewhere else,
   * and a dev server can keep running through it.
   */
  distDir: process.env.NEXT_DIST_DIR || '.next',

  // The app runs as a persistent Node process on Railway, not serverless.
  // Long-lived DB pools, SSE connections and in-process schedulers depend on
  // this. See CLAUDE.md "Stack" and D-002.
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    APP_VERSION: version,
    APP_MIGRATIONS: migrations,
  },
  // pino resolves its transports at runtime; bundling it produces a build that
  // works until the first log line. Same reason argon2 is here — a native
  // .node binding cannot be webpacked.
  serverExternalPackages: ['pino', '@node-rs/argon2'],
  eslint: {
    // Linting is a separate CI step (`pnpm lint`); don't run it twice on build.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
