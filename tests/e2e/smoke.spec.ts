import { readFileSync, existsSync } from 'node:fs';
import { test, expect } from '@playwright/test';

/**
 * The P0 smoke suite: the app boots, the database is migrated, and a printed
 * QR sticker reaches the room home with nothing in the way.
 *
 * Seed data comes from `.demo-seed.json`, written by `pnpm demo:reset`. QR
 * codes are regenerated on every reset and must never be cached, so the codes
 * cannot be hardcoded here — and these tests run in Playwright's process,
 * outside the app, so they cannot look them up in the database either.
 */
interface DemoSeed {
  propertyId: string;
  qrCodes: Record<string, string>;
}

const seedPath = '.demo-seed.json';
const seed: DemoSeed | null = existsSync(seedPath)
  ? (JSON.parse(readFileSync(seedPath, 'utf8')) as DemoSeed)
  : null;

test('health reports the app up, the database up, and no migration drift', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.ok()).toBe(true);

  const body = await res.json();
  expect(body.status).toBe('ok');
  expect(body.db.status).toBe('up');
  // The whole point of the migration block: a container running against a
  // database it has outgrown must say so rather than fail on the first query.
  expect(body.migrations.pending).toEqual([]);
  expect(body.migrations.unknown).toEqual([]);
  expect(res.headers()['x-request-id']).toBeTruthy();
});

test('every response carries the request id it was given', async ({ request }) => {
  const res = await request.get('/api/health', { headers: { 'x-request-id': 'e2e-trace-1' } });
  expect(res.headers()['x-request-id']).toBe('e2e-trace-1');
});

test('an unusable code is a bare 404 that reveals nothing', async ({ request }) => {
  // Unknown sticker, revoked sticker, wrong version, nobody checked in — all
  // the same 404. Someone scanning from a corridor must not learn which, and
  // in particular must not learn whether the room is occupied.
  const res = await request.get('/r/not-a-real-code', { maxRedirects: 0 });
  expect(res.status()).toBe(404);
  expect(await res.text()).toBe('');
});

test.describe('a scanned sticker', () => {
  test.skip(!seed, 'run `pnpm demo:reset` first — it writes .demo-seed.json');

  test('reaches the room home with no login and no verification', async ({ page }) => {
    const code = seed!.qrCodes['214'];
    expect(code, 'room 214 must exist in the demo property').toBeTruthy();

    // CLAUDE.md #9 / D-012: a bare scan is never gated. One redirect hop to
    // set the session cookie, and then the room.
    await page.goto(`/r/${code}`);
    await expect(page).toHaveURL(new RegExp(`/r/${code}/home$`));

    await expect(page.locator('body')).toContainText('214');
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /sign in|log in|verify/i })).toHaveCount(0);
  });

  test('browses the whole menu with no verification in the way', async ({ page }) => {
    const code = seed!.qrCodes['214'];
    await page.goto(`/r/${code}`);
    await page.getByRole('link', { name: /order to the room/i }).click();

    // Generous, and deliberately so: this render is several round trips to
    // Postgres, and against a database in another region it is seconds rather
    // than milliseconds. CI runs it against a local one and it is fast.
    await expect(page).toHaveURL(new RegExp(`/r/${code}/menu$`), { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'In-room dining' })).toBeVisible();

    // CLAUDE.md #9 — prices are visible to an anonymous REQUEST-tier session.
    // The one verification prompt comes at the first charge, not here.
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    // .first() because laal maas is deliberately in two sections — the price
    // appears twice, and that duplication is the design, not a bug.
    await expect(page.getByText('₹1,150').first()).toBeVisible();

    // The editorial sections lead, exactly as the reference browses.
    const headings = await page.getByRole('heading', { level: 2 }).allTextContents();
    expect(headings.slice(0, 3)).toEqual([
      'From the rooftop', 'After 10pm', 'Chef Bhairav’s table',
    ]);
    // One section per name — "From the rooftop" is both a category and a
    // collection here, and only the collection may render.
    expect(new Set(headings).size).toBe(headings.length);
  });

  test('the category rail follows the section under the header', async ({ page }) => {
    const code = seed!.qrCodes['214'];
    // Scan first. Going straight to /menu with no cookie is correct behaviour
    // — it bounces through the link, which mints a session and lands on the
    // room home — but it means there is no rail on the page to assert about.
    await page.goto(`/r/${code}`);
    await page.goto(`/r/${code}/menu`);

    await expect(page.locator('[aria-selected="true"]')).toHaveText('Rooftop');

    await page.locator('[data-section]').nth(2).scrollIntoViewIfNeeded();
    await expect(page.locator('[aria-selected="true"]')).toHaveText('Chef Bhairav');
  });

  test('does not mint a new session on every reload', async ({ page }) => {
    // The redirect hop exists so the cookie survives a refresh. Without it
    // every reload created a guest_sessions row and re-prompted a verified
    // guest — see the note in the route handler.
    const code = seed!.qrCodes['214'];
    await page.goto(`/r/${code}`);
    const first = (await page.context().cookies()).find((c) => c.name === 'hgs_guest')?.value;

    await page.goto(`/r/${code}`);
    const second = (await page.context().cookies()).find((c) => c.name === 'hgs_guest')?.value;

    expect(first).toBeTruthy();
    expect(second).toBe(first);
  });
});
