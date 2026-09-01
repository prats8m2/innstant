import { readFileSync, existsSync } from 'node:fs';
import { test, expect, devices, type Page } from '@playwright/test';

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
  /** Last four digits, for answering the one verification prompt (D-012). */
  guests: Record<string, { name: string; phoneLast4: string }>;
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

    /**
     * The editorial sections lead, exactly as the reference browses.
     *
     * "After 10pm" is seeded with a 22:00–01:00 window and the guest read
     * honours it now, so whether it is here depends on the hour in UDAIPUR —
     * not on the machine running the suite. Computing the expectation beats
     * asserting a fixed list that is wrong for three hours a night.
     */
    const inUdaipur = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false,
    }).format(new Date());
    const hour = Number(inUdaipur) % 24;
    const lateNight = hour >= 22 || hour < 1;

    const headings = await page.getByRole('heading', { level: 2 }).allTextContents();
    expect(headings.slice(0, lateNight ? 3 : 2)).toEqual(
      lateNight
        ? ['From the rooftop', 'After 10pm', 'Chef Bhairav’s table']
        : ['From the rooftop', 'Chef Bhairav’s table'],
    );
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

  test('asks its one question at the charge, then sends the order', async ({ page }) => {
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

    // Nothing has been asked so far — a bare scan grants REQUEST and browsing
    // was never gated (#9).
    await page.goto(`/r/${code}/cart`);
    await expect(page.locator('input[name="answer"]')).toHaveCount(0);

    await page.getByRole('button', { name: /Send to the kitchen/ }).click();

    // D-012: the ONE prompt, and it appears HERE — at the first attempt to
    // charge the room, not at the scan.
    await expect(page.locator('input[name="answer"]')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText(/last four digits of the phone number/i)).toBeVisible();

    // A wrong answer keeps the prompt and says so. It does not 403 and it does
    // not lose the order.
    await page.locator('input[name="answer"]').fill('9999');
    await page.getByRole('button', { name: /Confirm and send/ }).click();
    await expect(page.getByText(/does not match/i)).toBeVisible({ timeout: 25_000 });
    await expect(page).toHaveURL(/\/cart$/);

    await page.locator('input[name="answer"]').fill(seed!.guests['301']!.phoneLast4);
    await page.getByRole('button', { name: /Confirm and send/ }).click();

    // Verifying finishes the original action — the guest does not press Send
    // a second time.
    await page.waitForURL(/\/order\/[0-9a-f-]{36}$/, { timeout: 25_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Order to room 301/);
    await expect(page.getByText(/KE-\d+/).first()).toBeVisible();
    // The tracking timeline, with exactly one step lit — the order has been
    // placed and the kitchen has not touched it yet.
    await expect(page.locator('li[data-state="active"]')).toContainText('Order received');

    // The order itself is folded away, as the reference draws it. Everything
    // inside came from the order's snapshots, and the declined extra is not
    // among them.
    await page.getByText('Your order').click();
    await expect(page.getByText('As the chef makes it')).toBeVisible();
    await expect(page.getByText(/· Nothing/)).toHaveCount(0);
    await expect(page.getByText(/Charged to room 301/)).toBeVisible();

    // The cart is empty: the pill must not advertise an order already sent.
    await page.goto(`/r/${code}/menu`);
    await expect(page.getByText(/Kitchen open until/)).toBeVisible();

    // And the second order asks nothing at all. The prompt is once per
    // session, not once per order.
    await page.getByRole('link', { name: /Ker sangri/ }).first().click();
    await page.waitForURL(/\/menu\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await page.getByRole('button', { name: /Add to order/ }).click();
    await expect(page.getByText('Added to your order.')).toBeVisible({ timeout: 20_000 });

    await page.goto(`/r/${code}/cart`);
    await page.getByRole('button', { name: /Send to the kitchen/ }).click();
    await page.waitForURL(/\/order\/[0-9a-f-]{36}$/, { timeout: 25_000 });
    await expect(page.locator('input[name="answer"]')).toHaveCount(0);
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

/**
 * The kitchen, and the claim P1 exists to make: an order placed on a phone
 * appears on a second device, without a reload, in under two seconds.
 */
test.describe('the kitchen display', () => {
  test.skip(!seed, 'run `pnpm demo:reset` first — it writes .demo-seed.json');

  async function signIn(page: Page, email: string): Promise<void> {
    await page.goto('/admin/login');
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill('kesari-demo-2026');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 25_000 });
  }

  async function signInToKitchen(page: Page): Promise<void> {
    await page.goto('/kds');
    // The middleware is a turnstile: no cookie, no page.
    await expect(page).toHaveURL(/\/admin\/login/);

    await signIn(page, 'kitchen@thekesari.example');

    await page.goto('/kds');
    await expect(page.getByText('Live', { exact: true })).toBeVisible({ timeout: 25_000 });
  }

  test('turns a wrong password away without saying which half was wrong', async ({ page }) => {
    await page.goto('/admin/login');
    await page.locator('input[name="email"]').fill('kitchen@thekesari.example');
    await page.locator('input[name="password"]').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // A distinct "no such user" enumerates a hotel's staff list, and staff
    // emails are usually firstname@thehotel.com.
    // `.filter` because Next renders an always-present, always-empty route
    // announcer with role="alert" — see the note in the dish test above.
    await expect(page.getByRole('alert').filter({ hasText: /\S/ }))
      .toContainText(/email and password/i, { timeout: 25_000 });
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test('shows an order the moment it is placed, on another device', async ({ browser }) => {
    const code = seed!.qrCodes['214'];

    const kitchen = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const kds = await kitchen.newPage();
    await signInToKitchen(kds);

    const phone = await browser.newContext();
    const guest = await phone.newPage();
    await guest.goto(`/r/${code}`);
    await guest.goto(`/r/${code}/menu`);
    await guest.getByRole('link', { name: /Laal maas/ }).first().click();
    await guest.waitForURL(/\/menu\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await guest.getByRole('button', { name: /Add to order/ }).click();
    await expect(guest.getByText('Added to your order.')).toBeVisible({ timeout: 20_000 });

    await guest.goto(`/r/${code}/cart`);
    await guest.getByRole('button', { name: /Send to the kitchen/ }).click();
    await guest.locator('input[name="answer"]').waitFor({ timeout: 25_000 });
    await guest.locator('input[name="answer"]').fill(seed!.guests['214']!.phoneLast4);
    await guest.getByRole('button', { name: /Confirm and send/ }).click();
    await guest.waitForURL(/\/order\/[0-9a-f-]{36}$/, { timeout: 25_000 });

    const orderNumber = (await guest.getByText(/KE-\d+/).first().textContent())!.trim();

    // The claim. No reload anywhere in this test — the KDS page was loaded
    // before the order existed.
    const ticket = kds.locator('li').filter({ hasText: orderNumber });
    await expect(ticket).toBeVisible({ timeout: 10_000 });
    await expect(ticket).toContainText('Laal maas with bajra roti');
    await expect(ticket).toContainText('214');

    /**
     * And it can be worked — each bump a real transition through the machine,
     * and each one visible on the GUEST's phone without a reload. The phone has
     * been sitting on the tracking screen since before the kitchen signed in;
     * everything below arrives over its own SSE stream.
     */
    const activeStep = guest.locator('li[data-state="active"]');
    await expect(activeStep).toContainText('Order received');

    await ticket.getByRole('button', { name: 'Accept' }).click();
    await expect(ticket).toHaveAttribute('data-status', 'ACCEPTED', { timeout: 15_000 });
    await expect(activeStep).toContainText('In the kitchen', { timeout: 15_000 });

    await ticket.getByRole('button', { name: 'Start cooking' }).click();
    await expect(ticket).toHaveAttribute('data-status', 'PREPARING', { timeout: 15_000 });
    // Same step, different words: the guest's one piece of news between taken
    // and cooking is that a pan is on.
    await expect(activeStep).toContainText(/cooking/i, { timeout: 15_000 });

    await ticket.getByRole('button', { name: 'Ready' }).click();
    await expect(ticket).toHaveAttribute('data-status', 'READY', { timeout: 15_000 });
    await expect(activeStep).toContainText('Plated and covered', { timeout: 15_000 });

    /**
     * The last hop, and the one only the runner app can make. A second staff
     * device, a phone this time: the tray leaves the kitchen's rail, appears in
     * the runner's queue, and is handed over — which is where P1's exit
     * criterion ends and where the guest's timeline stops streaming.
     */
    const corridor = await browser.newContext({ ...devices['Pixel 7'] });
    const runner = await corridor.newPage();
    await signIn(runner, 'runner@thekesari.example');
    await runner.goto('/runner');
    await expect(runner.getByText('Live', { exact: true })).toBeVisible({ timeout: 25_000 });

    const tray = runner.locator('li').filter({ hasText: orderNumber });
    await expect(tray).toBeVisible({ timeout: 15_000 });
    await expect(tray).toContainText('214');

    await tray.getByRole('button', { name: 'Take it up' }).click();
    // Off the kitchen's rail once it leaves the kitchen.
    await expect(ticket).toHaveCount(0, { timeout: 15_000 });
    await expect(activeStep).toContainText('On the way up', { timeout: 15_000 });

    await tray.getByRole('button', { name: 'Handed over' }).click();
    await expect(tray).toHaveCount(0, { timeout: 15_000 });
    await expect(activeStep).toContainText('At your door', { timeout: 15_000 });
    // Nothing more will happen that the guest cares about, so the phone stops
    // holding a connection open on a nightstand.
    await expect(guest.getByText(/Updating as it moves|Reconnecting/)).toHaveCount(0);

    await corridor.close();
    await kitchen.close();
    await phone.close();
  });
});

/**
 * The ops console.
 *
 * The claim: a hotel can change its own menu, and the change is in front of the
 * guest on the next page load. Until this existed the only way to edit a menu
 * was to edit `kesari-menu.ts` and re-run the seeder, which also wipes the
 * property.
 */
test.describe('the menu editor', () => {
  /**
   * Serial within this file.
   *
   * These tests share one menu: repricing a dish and 86ing it are two tests
   * touching the same row, and `fullyParallel` runs them at once. The failure
   * surfaces as a price that is 387 in one assertion and 380 in the next, which
   * reads like a bug in the editor. Each browser project still runs in parallel
   * with the others, on its own dishes.
   */
  test.describe.configure({ mode: 'serial' });

  test.skip(!seed, 'run `pnpm demo:reset` first — it writes .demo-seed.json');

  /**
   * A dish of this project's own, that no ORDERING test touches.
   *
   * Two things collide here, and both cost a debugging round. Both browser
   * projects run every test against ONE database, so two projects editing the
   * same dish race each other — the cart tests solve that by giving each project
   * its own room. And a dish is a shared resource in its own right: this suite
   * 86s one, and `placeOrder()` refuses a cart holding an unavailable dish, so
   * taking Ker sangri off while the placement test was ordering it failed that
   * test with a cart that would not send.
   *
   * Laal maas and Ker sangri are ordered elsewhere in this file. These are not.
   */
  function ownDish(): string {
    return {
      'staff-desktop': 'Mohan maas',
      'guest-mobile': 'Mawa kachori',
      'guest-ios': 'Masala chai',
    }[test.info().project.name] ?? 'Mohan maas';
  }

  async function signInAsFnb(page: Page): Promise<void> {
    await page.goto('/admin/menu');
    // The middleware is a turnstile: no cookie, no page.
    await expect(page).toHaveURL(/\/admin\/login/);

    await page.locator('input[name="email"]').fill('fnb@thekesari.example');
    await page.locator('input[name="password"]').fill('kesari-demo-2026');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 25_000 });

    await page.goto('/admin/menu');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('In-room dining', {
      timeout: 25_000,
    });
  }

  test('reprices a dish, and the guest sees the new price', async ({ browser }) => {
    // Room 105 has its own stay; this test only reads the guest menu.
    const code = seed!.qrCodes['105'];

    const desk = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const admin = await desk.newPage();
    await signInAsFnb(admin);

    const dish = ownDish();
    await admin.getByRole('link', { name: dish }).click();
    await admin.waitForURL(/\/admin\/menu\/[0-9a-f-]{36}$/, { timeout: 20_000 });

    const price = admin.locator('input[name="price"]');
    const before = await price.inputValue();
    // +7 rather than a round number: the assertion below looks for the price on
    // the guest's menu, and a round increment can collide with another dish.
    const after = String(Number(before) + 7);

    await price.fill(after);
    await admin.getByRole('button', { name: /Add the dish|Save the dish/ }).click();
    await admin.waitForURL(/\/admin\/menu$/, { timeout: 25_000 });

    // The guest's own menu, rendered per request from the same rows.
    const phone = await browser.newContext();
    const guest = await phone.newPage();
    await guest.goto(`/r/${code}`);
    await guest.goto(`/r/${code}/menu`);
    await expect(guest.getByText(`₹${Number(after).toLocaleString('en-IN')}`).first())
      .toBeVisible({ timeout: 25_000 });

    // And the reprice is in the audit trail, with both numbers.
    await admin.getByRole('link', { name: dish }).click();
    await admin.waitForURL(/\/admin\/menu\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    // `.first()` — the suite is repeatable, so this dish accumulates reprices.
    await expect(admin.getByText(/Repriced from ₹/).first()).toBeVisible({ timeout: 20_000 });

    // Put it back, so the suite is repeatable.
    await admin.locator('input[name="price"]').fill(before);
    await admin.getByRole('button', { name: /Save the dish/ }).click();
    await admin.waitForURL(/\/admin\/menu$/, { timeout: 25_000 });

    await desk.close();
    await phone.close();
  });

  test('takes a dish off tonight and puts it back, without deleting anything',
    async ({ page }) => {
      await signInAsFnb(page);

      const name = ownDish();
      const row = () => page.locator('li').filter({ hasText: name }).first();

      await row().getByRole('button', { name: 'Take off' }).click();
      await expect(row()).toContainText('off tonight', { timeout: 20_000 });

      await row().getByRole('button', { name: 'Put back on' }).click();
      await expect(row()).not.toContainText('off tonight', { timeout: 20_000 });
    });

  test('will not archive a section while it still holds dishes', async ({ page }) => {
    await signInAsFnb(page);

    const section = page.locator('section').filter({ hasText: 'Rajasthani classics' }).first();
    await section.getByRole('button', { name: 'Archive section' }).click();

    // A count, not a refusal with no way forward.
    await expect(section.getByRole('alert')).toContainText(/dishes in this section first/i, {
      timeout: 20_000,
    });
  });

  test('a kitchen account can 86 a dish and nothing more', async ({ page }) => {
    // KITCHEN holds catalog:availability but not catalog:manage — the whole
    // point of splitting them (permissions.ts). The screen must reflect that
    // rather than offering buttons the action will refuse.
    await page.goto('/admin/login');
    await page.locator('input[name="email"]').fill('kitchen@thekesari.example');
    await page.locator('input[name="password"]').fill('kesari-demo-2026');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 25_000 });

    await page.goto('/admin/menu');
    await expect(page.getByRole('button', { name: 'Take off' }).first())
      .toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Archive section' })).toHaveCount(0);
    await expect(page.getByText('Add a section')).toHaveCount(0);
  });
});

/**
 * The kitchen's own settings.
 *
 * `outlet_hours` was written by provisioning and read by nothing: both guest
 * screens carried the literal "Kitchen open until 11:30pm" while the seeded rows
 * said 07:00–01:00. This asserts the loop is closed — the hours are editable,
 * and what a guest reads comes from them.
 */
test.describe('the kitchen settings', () => {
  test.skip(!seed, 'run `pnpm demo:reset` first — it writes .demo-seed.json');

  // Its own room, because the suite runs fully parallel against one database.
  const ROOM = '214';

  async function signInAsGm(page: Page): Promise<void> {
    await page.goto('/admin/outlet');
    await expect(page).toHaveURL(/\/admin\/login/);

    await page.locator('input[name="email"]').fill('gm@thekesari.example');
    await page.locator('input[name="password"]').fill('kesari-demo-2026');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 25_000 });

    await page.goto('/admin/outlet');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('The kitchen', {
      timeout: 25_000,
    });
  }

  test('shows the GM exactly the line a guest is reading', async ({ page }) => {
    await signInAsGm(page);

    // The seeded hours are 07:00–01:00 every day, so a guest reads one of these
    // two — and never the old hardcoded "11:30pm".
    await expect(page.getByText(/Kitchen open until 1am|The kitchen opens at 7am/))
      .toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('11:30pm')).toHaveCount(0);
  });

  test('a changed closing time is what the guest sees', async ({ browser }) => {
    const desk = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const admin = await desk.newPage();
    await signInAsGm(admin);

    // Open every day, closing at 22:45 — no midnight crossing, so this is
    // unambiguous whatever hour the suite runs at... except between 22:45 and
    // 07:00, where the guest correctly reads "opens at 7am" instead. Assert
    // whichever is true rather than pretending the clock stands still.
    for (let day = 0; day < 7; day += 1) {
      await admin.locator(`input[name="open-${day}"]`).setChecked(true);
      await admin.locator(`input[name="opensAt-${day}"]`).fill('07:00');
      await admin.locator(`input[name="closesAt-${day}"]`).fill('22:45');
      await admin.locator(`input[name="crossesMidnight-${day}"]`).setChecked(false);
    }
    await admin.getByRole('button', { name: 'Save the hours' }).click();
    await expect(admin.getByText(/Hours saved/)).toBeVisible({ timeout: 20_000 });

    const phone = await browser.newContext();
    const guest = await phone.newPage();
    await guest.goto(`/r/${seed!.qrCodes[ROOM]}`);
    await guest.goto(`/r/${seed!.qrCodes[ROOM]}/menu`);
    await expect(guest.getByText(/Kitchen open until 10:45pm|The kitchen opens at 7am/))
      .toBeVisible({ timeout: 25_000 });

    // Put the seeded hours back so the suite is repeatable.
    for (let day = 0; day < 7; day += 1) {
      await admin.locator(`input[name="closesAt-${day}"]`).fill('01:00');
      await admin.locator(`input[name="crossesMidnight-${day}"]`).setChecked(true);
    }
    await admin.getByRole('button', { name: 'Save the hours' }).click();
    await expect(admin.getByText(/Hours saved/)).toBeVisible({ timeout: 20_000 });

    await desk.close();
    await phone.close();
  });

  test('refuses hours that would silently read as closed', async ({ page }) => {
    await signInAsGm(page);

    // 19:00 to 02:00 without ticking "past midnight": the open-state logic
    // skips that window, so the kitchen would read as shut all evening.
    await page.locator('input[name="open-1"]').setChecked(true);
    await page.locator('input[name="opensAt-1"]').fill('19:00');
    await page.locator('input[name="closesAt-1"]').fill('02:00');
    await page.locator('input[name="crossesMidnight-1"]').setChecked(false);
    await page.getByRole('button', { name: 'Save the hours' }).click();

    // `.filter` because Next renders an always-present, always-empty route
    // announcer with role="alert" — the same trap as the login test above.
    await expect(page.getByRole('alert').filter({ hasText: /\S/ }))
      .toContainText(/past midnight/i, { timeout: 20_000 });
  });

  test('will not let a kitchen account near the rates', async ({ page }) => {
    // KITCHEN holds neither catalog:manage nor catalog:pricing. A tax rate is
    // a price, and this is the credential most likely to be left signed in.
    await page.goto('/admin/login');
    await page.locator('input[name="email"]').fill('kitchen@thekesari.example');
    await page.locator('input[name="password"]').fill('kesari-demo-2026');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 25_000 });

    await page.goto('/admin/outlet');
    // A staff page says so in words rather than returning a bare status: a
    // thrown ForbiddenError in a Server Component renders a 500, and "your role
    // cannot do this" is something the person reading it can act on.
    await expect(page.getByText(/cannot change this/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('input[name="taxRate"]')).toHaveCount(0);
  });
});

/**
 * Collections — how the menu reads.
 *
 * The guest menu's sections ARE collections, so this is the one piece of catalog
 * admin that changes the shape of what a guest sees rather than a value in it.
 */
test.describe('collections', () => {
  /**
   * Serial within this file.
   *
   * These tests share one menu: repricing a dish and 86ing it are two tests
   * touching the same row, and `fullyParallel` runs them at once. The failure
   * surfaces as a price that is 387 in one assertion and 380 in the next, which
   * reads like a bug in the editor. Each browser project still runs in parallel
   * with the others, on its own dishes.
   */
  test.describe.configure({ mode: 'serial' });

  test.skip(!seed, 'run `pnpm demo:reset` first — it writes .demo-seed.json');

  /** Per project, because both run against one database. */
  function ownName(): string {
    return `Tonight ${test.info().project.name}`;
  }

  function ownDish(): string {
    return {
      'staff-desktop': 'Mohan maas',
      'guest-mobile': 'Mawa kachori',
      'guest-ios': 'Masala chai',
    }[test.info().project.name] ?? 'Mohan maas';
  }

  test('a new collection becomes a section on the guest menu', async ({ browser }) => {
    const desk = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
    const admin = await desk.newPage();

    await admin.goto('/admin/menu/collections');
    await expect(admin).toHaveURL(/\/admin\/login/);
    await admin.locator('input[name="email"]').fill('fnb@thekesari.example');
    await admin.locator('input[name="password"]').fill('kesari-demo-2026');
    await admin.getByRole('button', { name: 'Sign in' }).click();
    await admin.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 25_000 });

    await admin.goto('/admin/menu/collections');
    await expect(admin.getByRole('heading', { level: 1 })).toHaveText('Collections', {
      timeout: 25_000,
    });

    // The seeded collections, with the state the guest read computes.
    await expect(admin.getByRole('heading', { name: 'From the rooftop' })).toBeVisible();
    await expect(admin.getByRole('heading', { name: 'After 10pm' })).toBeVisible();

    const name = ownName();
    const form = admin.locator('details').filter({ hasText: 'Add a collection' });
    await form.locator('summary').click();
    await form.locator('input[name="name"]').fill(name);
    await form.locator('textarea[name="editorialNote"]').fill('What we would order.');
    await form.locator(`label:has-text("${ownDish()}") input[type="checkbox"]`).first().check();
    await form.getByRole('button', { name: 'Add the collection' }).click();

    await expect(admin.getByRole('heading', { name })).toBeVisible({ timeout: 25_000 });

    // The guest's menu, which is where a collection actually lives.
    const phone = await browser.newContext();
    const guest = await phone.newPage();
    await guest.goto(`/r/${seed!.qrCodes['214']}`);
    await guest.goto(`/r/${seed!.qrCodes['214']}/menu`);
    await expect(guest.getByRole('heading', { name })).toBeVisible({ timeout: 25_000 });
    // Scoped to this project's own section: the other browser project runs the
    // same test against the same database and writes the same blurb.
    await expect(
      guest.locator('section')
        .filter({ has: guest.getByRole('heading', { name }) })
        .getByText('What we would order.'),
    ).toBeVisible();

    // Switched off, it leaves the menu — and stays on the editor's screen,
    // because it is the one someone came back to turn on again.
    const section = admin.locator('section').filter({ has: admin.getByRole('heading', { name }) });
    // Each collection's form is collapsed — the page would be thousands of
    // pixels tall otherwise.
    await section.locator('summary').click();
    await section.locator('input[name="isActive"]').uncheck();
    await section.getByRole('button', { name: 'Save the collection' }).click();
    await expect(section.getByText(/switched off/)).toBeVisible({ timeout: 25_000 });

    await guest.reload();
    await expect(guest.getByRole('heading', { name })).toHaveCount(0);

    // And archived, its dish is still on the menu: a collection is a view.
    await section.getByRole('button', { name: 'Archive' }).click();
    await expect(admin.getByRole('heading', { name })).toHaveCount(0, { timeout: 25_000 });

    await guest.reload();
    await expect(guest.getByRole('link', { name: new RegExp(ownDish()) }).first())
      .toBeVisible({ timeout: 25_000 });

    await desk.close();
    await phone.close();
  });

  test('refuses half a window, and says which half', async ({ page }) => {
    await page.goto('/admin/login');
    await page.locator('input[name="email"]').fill('fnb@thekesari.example');
    await page.locator('input[name="password"]').fill('kesari-demo-2026');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 25_000 });

    await page.goto('/admin/menu/collections');
    const section = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'From the rooftop' }),
    });
    await section.locator('summary').click();

    // "Showing from 22:00, forever" is a mistake, not a configuration.
    await section.locator('input[name="availableFrom"]').fill('22:00');
    await section.locator('input[name="availableUntil"]').fill('');
    await section.getByRole('button', { name: 'Save the collection' }).click();

    await expect(section.getByRole('alert').filter({ hasText: /\S/ }))
      .toContainText(/both a start and an end/i, { timeout: 20_000 });
  });
});

/**
 * Option groups.
 *
 * The claim worth testing: an option's price difference reaches the guest's
 * dish screen and moves the "Add to order" total. That is the whole path — an
 * F&B manager types +₹120, and a guest sees a dish get ₹120 dearer when they
 * pick it.
 */
test.describe('option groups', () => {
  /**
   * Serial within this file.
   *
   * These tests share one menu: repricing a dish and 86ing it are two tests
   * touching the same row, and `fullyParallel` runs them at once. The failure
   * surfaces as a price that is 387 in one assertion and 380 in the next, which
   * reads like a bug in the editor. Each browser project still runs in parallel
   * with the others, on its own dishes.
   */
  test.describe.configure({ mode: 'serial' });

  test.skip(!seed, 'run `pnpm demo:reset` first — it writes .demo-seed.json');

  function ownGroup(): string {
    return `Sides ${test.info().project.name}`;
  }

  /**
   * Its own dish, and NOT one the menu-editor tests reprice.
   *
   * Those use Mohan maas / Mawa kachori / Masala chai, and the placement tests
   * order Laal maas and Ker sangri. A dish being repriced by another test while
   * this one reads its price fails here with a total that is off by seven.
   */
  function ownDish(): string {
    return {
      'staff-desktop': 'Kesar lassi',
      'guest-mobile': 'Gatte ki sabzi',
      'guest-ios': 'Dal baati churma',
    }[test.info().project.name] ?? 'Kesar lassi';
  }

  function ownRoom(): string {
    return { 'staff-desktop': '214', 'guest-mobile': '105', 'guest-ios': '301' }[
      test.info().project.name
    ] ?? '214';
  }

  async function signInAsFnb(page: Page): Promise<void> {
    await page.goto('/admin/login');
    await page.locator('input[name="email"]').fill('fnb@thekesari.example');
    await page.locator('input[name="password"]').fill('kesari-demo-2026');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 25_000 });
  }

  test('shows the seeded groups with how many dishes carry them', async ({ page }) => {
    await signInAsFnb(page);
    await page.goto('/admin/menu/options');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Option groups', {
      timeout: 25_000,
    });
    // "Chilli" is one row shared by seven dishes — that reuse is the reason
    // this screen exists, so the count is on it.
    const chilli = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Chilli' }),
    });
    await expect(chilli).toContainText(/\d+ dishes/);
    await expect(chilli).toContainText('Extra fiery');
  });

  test('a new group prices a dish on the guest screen', async ({ browser }) => {
    const desk = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
    const admin = await desk.newPage();
    await signInAsFnb(admin);

    const group = ownGroup();
    await admin.goto('/admin/menu/options');

    // Create the group.
    const add = admin.locator('details').filter({ hasText: 'Add a group' }).first();
    await add.locator('summary').click();
    await add.locator('input[name="name"]').fill(group);
    await add.locator('input[name="maxSelections"]').fill('1');
    await add.getByRole('button', { name: 'Add the group' }).click();
    await expect(admin.getByRole('heading', { name: group })).toBeVisible({ timeout: 25_000 });

    const section = admin.locator('section').filter({
      has: admin.getByRole('heading', { name: group }),
    });

    /**
     * Two options: one free and default, one that costs. Named with the group's
     * own suffix — the seeded "Add" group already has a "Steamed rice", and the
     * dish carries it, so a bare name matches twice on the guest screen.
     */
    const paidOption = `Rice ${test.info().project.name}`;
    for (const [name, delta, isDefault] of [
      [`None ${test.info().project.name}`, '0', true],
      [paidOption, '120', false],
    ] as const) {
      const form = section.locator('details').filter({ hasText: 'Add an option' }).first();
      await form.locator('summary').click();
      await form.locator('input[name="name"]').fill(name);
      await form.locator('input[name="priceDelta"]').fill(delta);
      if (isDefault) await form.locator('input[name="isDefault"]').check();
      await form.getByRole('button', { name: 'Add the option' }).click();
      // Scoped to the option LIST: the form's own "… saved." message matches
      // the name too.
      await expect(section.locator('li').filter({ hasText: name }))
        .toBeVisible({ timeout: 25_000 });
      // Collapse it again so the next iteration finds a closed form.
      await form.locator('summary').click();
    }

    await expect(section.getByText('+₹120')).toBeVisible();

    // Attach it to a dish, from the dish form — where attachment belongs.
    await admin.goto('/admin/menu');
    await admin.getByRole('link', { name: ownDish() }).click();
    await admin.waitForURL(/\/admin\/menu\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await admin.locator(`label:has-text("${group}") input[type="checkbox"]`).first().check();
    await admin.getByRole('button', { name: 'Save the dish' }).click();
    await admin.waitForURL(/\/admin\/menu$/, { timeout: 25_000 });

    // The guest's dish screen: the group is there, and choosing the paid option
    // moves the total on the button.
    const phone = await browser.newContext();
    const guest = await phone.newPage();
    const code = seed!.qrCodes[ownRoom()]!;
    await guest.goto(`/r/${code}`);
    await guest.goto(`/r/${code}/menu`);
    await guest.getByRole('link', { name: new RegExp(ownDish()) }).first().click();
    await guest.waitForURL(/\/menu\/[0-9a-f-]{36}$/, { timeout: 20_000 });

    await expect(guest.getByText(group)).toBeVisible({ timeout: 20_000 });

    /**
     * The claim, measured as a DIFFERENCE rather than an absolute.
     *
     * The button shows the dish plus whatever options are preselected, so an
     * absolute figure depends on the seeded defaults of every group the dish
     * carries. What this test is actually about is that +₹120 typed in the
     * console moves the guest's total by ₹120.
     */
    const addButton = guest.getByRole('button', { name: /Add to order/ });
    const totalOn = async () => {
      const text = (await addButton.textContent()) ?? '';
      const digits = /₹([\d,]+)/.exec(text)?.[1]?.replace(/,/g, '');
      expect(digits, `no total on the button: ${text}`).toBeTruthy();
      return Number(digits);
    };

    const before = await totalOn();
    await guest.getByText(paidOption).click();
    await expect
      .poll(totalOn, { timeout: 20_000 })
      .toBe(before + 120);

    // Tidy up: take the group off the dish and archive it, so the suite is
    // repeatable and the next run's dish is the seeded one.
    await admin.goto('/admin/menu/options');
    const back = admin.locator('section').filter({
      has: admin.getByRole('heading', { name: group }),
    });
    await back.locator('details').filter({ hasText: 'Group settings' }).locator('summary').click();
    await back.getByRole('button', { name: /Archive and take it off 1 dish/ }).click();
    await expect(admin.getByRole('heading', { name: group })).toHaveCount(0, { timeout: 25_000 });

    await desk.close();
    await phone.close();
  });

  test('refuses a required group a guest could skip', async ({ page }) => {
    await signInAsFnb(page);
    await page.goto('/admin/menu/options');

    const add = page.locator('details').filter({ hasText: 'Add a group' }).first();
    await add.locator('summary').click();
    await add.locator('input[name="name"]').fill('Impossible');
    await add.locator('input[name="minSelections"]').fill('0');
    await add.locator('input[name="maxSelections"]').fill('2');
    await add.locator('input[name="isRequired"]').check();
    await add.getByRole('button', { name: 'Add the group' }).click();

    await expect(add.getByRole('alert').filter({ hasText: /\S/ }))
      .toContainText(/minimum of at least one/i, { timeout: 20_000 });
  });
});

/**
 * The kitchen's own tools: the count of tickets nobody has accepted, and 86ing a
 * dish from the board.
 */
test.describe('the kitchen board', () => {
  /**
   * Serial within this file.
   *
   * These tests share one menu: repricing a dish and 86ing it are two tests
   * touching the same row, and `fullyParallel` runs them at once. The failure
   * surfaces as a price that is 387 in one assertion and 380 in the next, which
   * reads like a bug in the editor. Each browser project still runs in parallel
   * with the others, on its own dishes.
   */
  test.describe.configure({ mode: 'serial' });

  test.skip(!seed, 'run `pnpm demo:reset` first — it writes .demo-seed.json');

  /** Its own dish, and one no ordering or menu-editor test touches. */
  function ownDish(): string {
    return {
      'staff-desktop': 'Udaipur-style pyaaz kachori',
      'guest-mobile': 'Rooftop grilled river sole',
      'guest-ios': 'Kesar lassi',
    }[test.info().project.name] ?? 'Udaipur-style pyaaz kachori';
  }

  function ownRoom(): string {
    return { 'staff-desktop': '214', 'guest-mobile': '105', 'guest-ios': '301' }[
      test.info().project.name
    ] ?? '214';
  }

  test('counts tickets nobody has accepted, and clears it on accept', async ({ browser }) => {
    const kitchen = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const kds = await kitchen.newPage();
    await kds.goto('/admin/login');
    await kds.locator('input[name="email"]').fill('kitchen@thekesari.example');
    await kds.locator('input[name="password"]').fill('kesari-demo-2026');
    await kds.getByRole('button', { name: 'Sign in' }).click();
    await kds.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 25_000 });
    await kds.goto('/kds');
    await expect(kds.getByText('Live', { exact: true })).toBeVisible({ timeout: 25_000 });

    // The seeder leaves one PLACED order, so the badge is already there.
    await expect(kds.getByText(/\d+ waiting/)).toBeVisible({ timeout: 20_000 });

    // 86 a dish from the board. The KITCHEN role holds catalog:availability and
    // nothing else on the catalog, which is exactly what this button needs.
    const dish = ownDish();
    const line = kds.locator('li').filter({ hasText: dish }).first();
    if (await line.count()) {
      await line.getByRole('button', { name: '86' }).first().click();
      await kds.waitForTimeout(1500);
    } else {
      // No open ticket happens to carry this dish; take it off through the
      // admin menu instead so the guest assertion below still means something.
      await kds.goto('/admin/menu');
      await kds.locator('li').filter({ hasText: dish }).first()
        .getByRole('button', { name: 'Take off' }).click();
      await kds.waitForTimeout(1500);
    }

    // The guest menu shows it as off.
    const phone = await browser.newContext();
    const guest = await phone.newPage();
    const code = seed!.qrCodes[ownRoom()]!;
    await guest.goto(`/r/${code}`);
    await guest.goto(`/r/${code}/menu`);
    const card = guest.locator('li').filter({ hasText: dish }).first();
    await expect(card).toContainText(/not available now/i, { timeout: 25_000 });

    // Put it back, so the suite is repeatable.
    await kds.goto('/admin/menu');
    await kds.locator('li').filter({ hasText: dish }).first()
      .getByRole('button', { name: 'Put back on' }).click();
    await expect(kds.locator('li').filter({ hasText: dish }).first())
      .not.toContainText('off tonight', { timeout: 20_000 });

    await kitchen.close();
    await phone.close();
  });
});

/**
 * P2 — amenities and the one-tap service call.
 *
 * The claims: a free request costs a guest no prompt (#9), a chargeable one gets
 * the same one question a dinner does (D-012), and the one tap is one tap.
 */
test.describe('asking for things', () => {
  test.skip(!seed, 'run `pnpm demo:reset` first — it writes .demo-seed.json');

  /** Its own room, like every guest test here — a request belongs to a stay. */
  function ownRoom(): string {
    return { 'staff-desktop': '214', 'guest-mobile': '105', 'guest-ios': '301' }[
      test.info().project.name
    ] ?? '214';
  }

  test('a free request needs no prompt at all', async ({ page }) => {
    const code = seed!.qrCodes[ownRoom()]!;
    await page.goto(`/r/${code}`);

    // From the room home, which now goes somewhere.
    await page.getByRole('link', { name: /Amenities/ }).click();
    await expect(page).toHaveURL(new RegExp(`/r/${code}/amenities$`), { timeout: 20_000 });

    // #9 — the whole list is readable at REQUEST tier, prices and all.
    await expect(page.getByText('Extra towels')).toBeVisible();
    await expect(page.getByText('Laundry service')).toBeVisible();
    await expect(page.locator('input[name="answer"]')).toHaveCount(0);

    // Two towels, sent.
    const towels = page.locator('li').filter({ hasText: 'Extra towels' }).first();
    await towels.getByRole('button', { name: /One more Extra towels/ }).click();
    await towels.getByRole('button', { name: /One more Extra towels/ }).click();
    await page.locator('input[name="guestNote"]').fill('Leave them by the door.');
    await page.getByRole('button', { name: /Send 2 to room/ }).click();

    // Lands on the request, with no question asked.
    await page.waitForURL(/\/service\/[0-9a-f-]{36}$/, { timeout: 25_000 });
    await expect(page.getByText(/Someone is coming up|on the way/)).toBeVisible();
    await expect(page.getByText('2×')).toBeVisible();
    await expect(page.getByText('Extra towels')).toBeVisible();
    await expect(page.getByText(/Nothing to pay/)).toBeVisible();
    await expect(page.getByText('Leave them by the door.')).toBeVisible();

    // And it can be called off while it is live.
    await page.getByRole('button', { name: /never mind/i }).click();
    await expect(page.getByText('Cancelled')).toBeVisible({ timeout: 20_000 });
  });

  test('a chargeable request asks the one question', async ({ page }) => {
    const room = ownRoom();
    const code = seed!.qrCodes[room]!;
    await page.goto(`/r/${code}`);
    await page.goto(`/r/${code}/amenities`);

    // Laundry costs ₹450 — the price is stated before anything is committed.
    const laundry = page.locator('li').filter({ hasText: 'Laundry service' }).first();
    await expect(laundry).toContainText('₹450');
    await laundry.getByRole('button', { name: /One more Laundry service/ }).click();
    await page.getByRole('button', { name: /Send 1 to room/ }).click();

    // D-012: the one prompt, HERE, at the first attempt to charge.
    await expect(page.locator('input[name="answer"]')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText(/₹450 goes on room/)).toBeVisible();

    // A wrong answer keeps the prompt and does not lose the request.
    await page.locator('input[name="answer"]').fill('9999');
    await page.getByRole('button', { name: 'Confirm and send' }).click();
    await expect(page.getByText(/does not match/i)).toBeVisible({ timeout: 25_000 });

    await page.locator('input[name="answer"]').fill(seed!.guests[room]!.phoneLast4);
    await page.getByRole('button', { name: 'Confirm and send' }).click();

    // Verifying completes the original action — no second send.
    await page.waitForURL(/\/service\/[0-9a-f-]{36}$/, { timeout: 25_000 });
    await expect(page.getByText(/₹450 is on room/)).toBeVisible();

    await page.getByRole('button', { name: /never mind/i }).click();
    await expect(page.getByText('Cancelled')).toBeVisible({ timeout: 20_000 });
  });

  test('the one tap is one tap', async ({ page }) => {
    const code = seed!.qrCodes[ownRoom()]!;
    await page.goto(`/r/${code}`);
    await page.getByRole('link', { name: /Call for service/ }).click();
    await expect(page).toHaveURL(new RegExp(`/r/${code}/service$`), { timeout: 20_000 });

    await expect(page.getByText(/Someone comes up to room/)).toBeVisible();
    await expect(page.getByText(/No queue, no call, no reason needed/)).toBeVisible();

    await page.getByRole('button', { name: /Ask someone to come up/ }).click();
    await page.waitForURL(/\/service\/[0-9a-f-]{36}$/, { timeout: 25_000 });
    await expect(page.getByText(/Someone is coming up|on the way/)).toBeVisible();
    // Free, so nothing was asked and nothing is owed.
    await expect(page.getByText(/Nothing to pay/)).toBeVisible();

    await page.getByRole('button', { name: /never mind/i }).click();
    await expect(page.getByText('Cancelled')).toBeVisible({ timeout: 20_000 });
  });

  test('the rows that go nowhere yet say so', async ({ page }) => {
    const code = seed!.qrCodes[ownRoom()]!;
    await page.goto(`/r/${code}`);

    // P3 and P4. A row that looks tappable and does nothing is worse than one
    // that says it is coming.
    await expect(page.getByText(/Folio and checkout · soon/)).toBeVisible();
    await expect(page.getByRole('link', { name: /Your stay/ })).toHaveCount(0);
  });
});

/**
 * The floor board.
 *
 * The claim: a request a guest raises appears on a staff phone without a reload,
 * with the clock on it, and can be taken and finished from there.
 */
test.describe('the floor board', () => {
  test.skip(!seed, 'run `pnpm demo:reset` first — it writes .demo-seed.json');

  function ownRoom(): string {
    return { 'staff-desktop': '214', 'guest-mobile': '105', 'guest-ios': '301' }[
      test.info().project.name
    ] ?? '214';
  }

  test('a guest request appears on the board, and can be worked', async ({ browser }) => {
    // A housekeeper's phone, opened BEFORE the request exists.
    const pocket = await browser.newContext({ ...devices['Pixel 7'] });
    const board = await pocket.newPage();
    await board.goto('/housekeeping');
    // The middleware is a turnstile: no cookie, no board.
    await expect(board).toHaveURL(/\/admin\/login/);

    await board.locator('input[name="email"]').fill('housekeeping@thekesari.example');
    await board.locator('input[name="password"]').fill('kesari-demo-2026');
    await board.getByRole('button', { name: 'Sign in' }).click();
    await board.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 25_000 });
    await board.goto('/housekeeping');
    await expect(board.getByText('Live', { exact: true })).toBeVisible({ timeout: 25_000 });

    // The guest asks for two towels.
    const room = ownRoom();
    const phone = await browser.newContext();
    const guest = await phone.newPage();
    await guest.goto(`/r/${seed!.qrCodes[room]}`);
    await guest.goto(`/r/${seed!.qrCodes[room]}/amenities`);
    const towels = guest.locator('li').filter({ hasText: 'Extra towels' }).first();
    await towels.getByRole('button', { name: /One more Extra towels/ }).click();
    await towels.getByRole('button', { name: /One more Extra towels/ }).click();
    await guest.locator('input[name="guestNote"]').fill('By the door is fine.');
    await guest.getByRole('button', { name: /Send 2 to room/ }).click();
    await guest.waitForURL(/\/service\/[0-9a-f-]{36}$/, { timeout: 25_000 });

    const ref = (await guest.getByText(/SR-\d+/).first().textContent())!.trim();

    // The claim: no reload anywhere on the board's side.
    const card = board.locator('li').filter({ hasText: ref });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toContainText(room);
    await expect(card).toContainText('Extra towels');
    await expect(card).toContainText('By the door is fine.');
    // The clock is on it — 12 minutes for towels, so it reads as minutes left.
    await expect(card).toContainText(/\d+m left/);

    // Take it and finish it.
    await card.getByRole('button', { name: 'I am going' }).click();
    await expect(card).toHaveAttribute('data-status', 'IN_PROGRESS', { timeout: 15_000 });
    await expect(card).toContainText('Yours');

    await card.getByRole('button', { name: 'Done' }).click();
    // COMPLETED is still on the board — a supervisor may verify it — but the
    // clock has stopped.
    await expect(card).toHaveAttribute('data-status', 'COMPLETED', { timeout: 15_000 });
    await expect(card).not.toContainText(/m left|m over/);

    // And the guest was told, without touching their phone.
    await expect(guest.getByText('Done')).toBeVisible({ timeout: 20_000 });

    await pocket.close();
    await phone.close();
  });

  test('turns away an account that cannot see requests', async ({ page }) => {
    // KITCHEN holds no request permission at all.
    await page.goto('/admin/login');
    await page.locator('input[name="email"]').fill('kitchen@thekesari.example');
    await page.locator('input[name="password"]').fill('kesari-demo-2026');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 25_000 });

    await page.goto('/housekeeping');
    await expect(page.getByText(/cannot see service requests/i)).toBeVisible({ timeout: 20_000 });
  });
});
