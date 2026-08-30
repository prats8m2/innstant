import { readFileSync, existsSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';

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

/**
 * Clear whatever a previous run left in this room's cart.
 *
 * The stepper's minus button is labelled "One fewer X" above a quantity of one
 * and "Remove X" at one, so clearing a line of two takes two clicks and a
 * locator that matches both. Matching only /^Remove/ leaves the cart full and
 * every exact-total assertion downstream fails somewhere unrelated.
 */
async function emptyCart(page: Page, code: string): Promise<void> {
  await page.goto(`/r/${code}/cart`);
  for (let i = 0; i < 30; i += 1) {
    const step = page.getByRole('button', { name: /^(Remove|One fewer) / }).first();
    if (!(await step.count())) break;
    await step.click();
    await page.waitForTimeout(250);
  }
}

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

  test('opens a dish, prices the choice live, and adds it to the order', async ({ page }) => {
    const code = seed!.qrCodes['214'];
    await page.goto(`/r/${code}`);
    await page.goto(`/r/${code}/menu`);

    await page.getByRole('link', { name: /Laal maas/ }).first().click();
    await page.waitForURL(/\/menu\/[0-9a-f-]{36}$/, { timeout: 20_000 });

    await expect(page.getByRole('heading', { level: 1 }))
      .toHaveText('Laal maas with bajra roti');

    // The chef's own recipe is preselected — a guest opts DOWN from the heat,
    // never in to it.
    await expect(page.getByRole('radio', { name: 'As the chef makes it' })).toBeChecked();

    const addButton = page.getByRole('button', { name: /Add to order/ });
    await expect(addButton).toContainText('₹1,150');

    // The button total is the only reason this screen needs JavaScript.
    await page.getByText('Extra bajra roti').click();
    await page.getByRole('button', { name: 'One more' }).click();
    await expect(addButton).toContainText('₹2,480');   // (1150 + 90) x 2

    await addButton.click();
    await expect(page.getByText('Added to your order.')).toBeVisible({ timeout: 20_000 });
    // Next renders its own always-present, always-empty route announcer with
    // role="alert" — so this asks for an alert with any content in it.
    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);
  });

  test('a dish id that is not on this menu is a 404', async ({ page }) => {
    const code = seed!.qrCodes['214'];
    // Scan first — without a session the dish route correctly bounces through
    // the link instead, and this would assert nothing.
    await page.goto(`/r/${code}`);

    const res = await page.goto(`/r/${code}/menu/00000000-0000-4000-8000-000000000000`);
    expect(res!.status()).toBe(404);
  });

  test('carries the order to the cart, edits it, and empties it', async ({ page }) => {
    // Room 105, not 214. A cart is keyed to the stay (#10), the suite runs
    // fully parallel, and the dish test above is adding to 214's cart at the
    // same moment — two tests sharing one cart is a flake waiting to happen.
    const code = seed!.qrCodes['105'];
    await page.goto(`/r/${code}`);

    // Start from a known cart. A previous failed run leaves lines behind, and
    // this asserts on exact totals.
    //
    // Both labels, because the minus button says "One fewer" until the
    // quantity is one and "Remove" at one — matching only /^Remove/ silently
    // fails to clear a line of two, which is exactly how this flaked.
    await emptyCart(page, code);

    await page.goto(`/r/${code}/menu`);

    // Nothing chosen yet: the pill is the one useful fact, not a dead button.
    await expect(page.getByText(/Kitchen open until/)).toBeVisible();

    await page.getByRole('link', { name: /Laal maas/ }).first().click();
    await page.waitForURL(/\/menu\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await page.getByRole('button', { name: /Add to order/ }).click();
    await expect(page.getByText('Added to your order.')).toBeVisible({ timeout: 20_000 });

    await page.goto(`/r/${code}/menu`);
    const pill = page.getByRole('link', { name: /Review order/ });
    await expect(pill).toContainText('₹1,207.50');   // 1150 + 5% tax

    await pill.click();
    await page.waitForURL(/\/cart$/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your order');
    // Regex, not a string: a plain substring also matches the ancestors that
    // contain it, which is a strict-mode violation rather than a failure.
    await expect(page.getByText(/To room 105/)).toBeVisible();

    // "Nothing" is a stored choice, and it is not printed on the line.
    await expect(page.getByText('As the chef makes it')).toBeVisible();
    await expect(page.getByText(/· Nothing/)).toHaveCount(0);

    // Scoped to the totals list: the send button carries the same figure, so a
    // bare getByText matches twice and fails as a strict-mode violation.
    const totals = page.locator('dl');

    await page.getByRole('button', { name: 'One more Laal maas with bajra roti' }).click();
    await expect(totals.getByText('₹2,415')).toBeVisible({ timeout: 20_000 });  // 2300 + 5%

    // One control, one job: at a quantity of one the minus says Remove.
    await page.getByRole('button', { name: 'One fewer Laal maas with bajra roti' }).click();
    await expect(totals.getByText('₹1,207.50')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Remove Laal maas with bajra roti' }).click();
    await expect(page.getByText('Nothing in the order yet.')).toBeVisible({ timeout: 20_000 });
  });

  test('sends the order to the kitchen and lands on the confirmation', async ({ page }) => {
    // Room 301 — its own stay, so this does not race the cart test on 105 or
    // the dish test on 214 (the suite runs fully parallel against one database).
    const code = seed!.qrCodes['301'];
    await page.goto(`/r/${code}`);

    await emptyCart(page, code);

    await page.goto(`/r/${code}/menu`);
    await page.getByRole('link', { name: /Laal maas/ }).first().click();
    await page.waitForURL(/\/menu\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await page.getByRole('button', { name: /Add to order/ }).click();
    await expect(page.getByText('Added to your order.')).toBeVisible({ timeout: 20_000 });

    await page.goto(`/r/${code}/cart`);
    await page.getByRole('button', { name: /Send to the kitchen/ }).click();

    await page.waitForURL(/\/order\/[0-9a-f-]{36}$/, { timeout: 25_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('It is with the kitchen');
    await expect(page.getByText(/ORDER KE-\d+/i)).toBeVisible();
    await expect(page.getByText(/On your folio/)).toBeVisible();

    // Everything on this screen came from the order's snapshots, and the
    // declined extra is not among them.
    await expect(page.getByText('As the chef makes it')).toBeVisible();
    await expect(page.getByText(/· Nothing/)).toHaveCount(0);

    // The cart is empty: the pill must not advertise an order already sent.
    await page.goto(`/r/${code}/menu`);
    await expect(page.getByText(/Kitchen open until/)).toBeVisible();
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
