import { defineConfig, devices } from '@playwright/test';

/**
 * The port, and therefore the base URL, is configurable — and both the browser
 * and the server it starts have to agree on it.
 *
 * They used to disagree: `baseURL` read APP_URL while `webServer.url` was
 * hardcoded to :3000. With `reuseExistingServer` on, a dev server already
 * running on :3000 was silently adopted as the system under test, and the whole
 * suite ran against whatever that happened to be serving.
 *
 * Pair with NEXT_DIST_DIR to build somewhere other than `.next` (see
 * next.config.ts), and a dev server can keep running through an e2e run:
 *
 *   PORT=3200 NEXT_DIST_DIR=.next-e2e pnpm test:e2e
 */
const PORT = process.env.PORT ?? '3000';
const BASE_URL = process.env.APP_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    // Guest routes are mobile-only (CLAUDE.md "UI") and the design is drawn at
    // 390x844. Testing them in a desktop viewport would test a layout that
    // does not exist.
    { name: 'guest-mobile', use: { ...devices['Pixel 7'] } },
    { name: 'staff-desktop', use: { ...devices['Desktop Chrome'] } },

    // Half the guests are international and iPhone-heavy, and this is a mobile
    // web app — iOS Safari behaviour is load-bearing, not a nice-to-have.
    // WebKit segfaults on some local macOS setups, so it runs in CI (Linux)
    // and on demand locally via PW_WEBKIT=1.
    ...(process.env.CI || process.env.PW_WEBKIT
      ? [{ name: 'guest-ios', use: { ...devices['iPhone 13'] } }]
      : []),
  ],
  webServer: {
    command: 'pnpm build && pnpm start',
    url: `${BASE_URL}/api/health`,
    env: { PORT },
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
