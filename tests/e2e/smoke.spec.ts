import { test, expect } from '@playwright/test';

test('health endpoint responds', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.status).toBe('ok');
});

test('a QR route renders without a login or verification screen', async ({ page }) => {
  // CLAUDE.md #9 / D-012: a bare scan is never gated. This assertion is trivial
  // today and load-bearing from S7 onward.
  await page.goto('/r/demo-code');
  await expect(page.locator('body')).toContainText('demo-code');
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
});
