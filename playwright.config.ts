import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.APP_URL ?? 'http://localhost:3000',
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
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
