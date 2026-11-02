/**
 * `pnpm demo:activity` — a busy evening on the demo property, made through
 * the app itself.
 *
 * `demo:reset` leaves The Kesari quiet: rooms, guests, a menu, a few seeded
 * orders. That is the right start for tests and the wrong one for looking at
 * the floor screens, which are about tickets moving. This fills them the way
 * guests and staff would: room guests order through the guest app and ask for
 * towels, two takeaways come in through the property link, the kitchen
 * accepts and cooks, a runner takes a tray, housekeeping clocks in and takes a
 * request.
 *
 * Every write goes through a real screen or the public API — never SQL — so
 * each one passes the same rules, idempotency and event log as a guest's tap.
 * Each step is logged and a failure in one does not stop the rest.
 *
 * Needs the app running: APP_URL (default http://localhost:3000). Run
 * `pnpm demo:reset` first for a clean start; running it twice simply adds a
 * second evening on top.
 */
import { chromium, request, type Browser, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const BASE = process.env.APP_URL ?? 'http://localhost:3000';
const seed = JSON.parse(readFileSync('.demo-seed.json', 'utf8')) as {
  qrCodes: Record<string, string>;
  visitLinks: Record<'TABLE' | 'COUNTER' | 'ONLINE', string>;
  guests: Record<string, { phoneLast4: string }>;
  staffPassword: string;
};

const log = (what: string, detail = '') => console.log(`  ✓ ${what}${detail ? ` — ${detail}` : ''}`);
const warn = (what: string, error: unknown) =>
  console.log(`  ✗ ${what} — ${(error as Error).message.split('\n')[0]}`);

async function step<T>(what: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    warn(what, error);
    return null;
  }
}

/** A room guest orders one dish through the guest app and confirms the charge. */
async function roomOrder(browser: Browser, room: string, dish: RegExp): Promise<string> {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const code = seed.qrCodes[room]!;
  await page.goto(`${BASE}/r/${code}`);
  await page.goto(`${BASE}/r/${code}/menu`);
  await page.getByRole('link', { name: dish }).first().click();
  await page.waitForURL(/\/menu\/[0-9a-f-]{36}$/, { timeout: 120_000 });
  await page.getByRole('button', { name: /Add to order/ }).click();
  await page.getByText('Added to your order.').waitFor({ timeout: 120_000 });
  await page.goto(`${BASE}/r/${code}/cart`);
  await page.getByRole('button', { name: /Send to the kitchen/ }).click();
  const answer = page.locator('input[name="answer"]');
  await answer.waitFor({ timeout: 120_000 });
  await answer.fill(seed.guests[room]!.phoneLast4);
  await page.getByRole('button', { name: /Confirm and send/ }).click();
  await page.waitForURL(/\/order\/[0-9a-f-]{36}$/, { timeout: 120_000 });
  const number = (await page.getByText(/KE-\d+/).first().textContent())!.match(/KE-\d+/)![0];
  await page.context().close();
  return number;
}

/** A takeaway through the property link, over the same API the app uses. */
async function takeaway(name: string): Promise<string> {
  const api = await request.newContext({ baseURL: BASE });
  const opened = await (await api.post('/api/v1/visits', { data: { code: seed.visitLinks.ONLINE } })).json();
  const auth = { authorization: `Bearer ${opened.token}` };
  const menu = await (await api.get('/api/v1/menu', { headers: auth })).json();
  const dishes = menu.sections
    .flatMap((section: { items: Array<{ id: string; canQuickAdd: boolean }> }) => section.items)
    .filter((item: { canQuickAdd: boolean }) => item.canQuickAdd);
  for (const dish of dishes.slice(0, 2)) {
    await api.post('/api/v1/cart/quick-add', { headers: auth, data: { menuItemId: dish.id, direction: 'add' } });
  }
  const placed = await (await api.post('/api/v1/orders', {
    headers: auth,
    data: { idempotencyKey: randomUUID(), name, phone: '9829000000', fulfilment: 'TAKEAWAY' },
  })).json();
  await api.dispose();
  return placed.orderNumber ?? placed.order?.orderNumber ?? '(placed)';
}

/** A room guest asks for N of an amenity through the guest app. */
async function amenity(browser: Browser, room: string, item: string, count: number): Promise<void> {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const code = seed.qrCodes[room]!;
  await page.goto(`${BASE}/r/${code}`);
  await page.goto(`${BASE}/r/${code}/amenities`);
  const row = page.locator('li').filter({ has: page.getByRole('button', { name: `One more ${item}` }) }).first();
  for (let i = 0; i < count; i += 1) await row.getByRole('button', { name: new RegExp(`One more ${item}`) }).click();
  await page.getByRole('button', { name: new RegExp(`Send ${count} to room`) }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/amenities'), { timeout: 120_000 });
  await page.context().close();
}

async function staff(browser: Browser, email: string, viewport = { width: 1280, height: 900 }): Promise<Page> {
  const page = await (await browser.newContext({ viewport })).newPage();
  await page.goto(`${BASE}/admin/login`);
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', seed.staffPassword);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 120_000 }),
    page.click('button[type=submit]'),
  ]);
  return page;
}

/** Press the kitchen's buttons on one ticket, in order. */
async function kitchen(page: Page, orderNumber: string, buttons: string[]): Promise<void> {
  const ticket = page.locator('li').filter({ hasText: orderNumber }).first();
  await ticket.waitFor({ timeout: 120_000 });
  for (const name of buttons) {
    await ticket.getByRole('button', { name, exact: true }).click();
    await page.waitForTimeout(1_200);
  }
}

async function main(): Promise<void> {
  console.log(`A busy evening at The Kesari, through ${BASE}\n`);
  const browser = await chromium.launch();
  // `next dev` compiles a page the first time it is opened, which can take
  // longer than Playwright's 30s default on a cold server.
  const contexts = browser.newContext.bind(browser);
  browser.newContext = async (options) => {
    const context = await contexts(options);
    context.setDefaultTimeout(120_000);
    context.setDefaultNavigationTimeout(120_000);
    return context;
  };

  console.log('Guests order');
  const orders: Record<string, string | null> = {};
  for (const [room, dish] of [
    ['214', /Laal maas/], ['210', /Ker sangri/], ['105', /Dal baati/], ['301', /Mohan maas/],
  ] as const) {
    orders[room] = await step(`room ${room} orders`, () => roomOrder(browser, room, dish));
    if (orders[room]) log(`room ${room} orders`, orders[room]!);
  }
  for (const name of ['Aman', 'Priya']) {
    orders[name] = await step(`${name} orders a takeaway`, () => takeaway(name));
    if (orders[name]) log(`${name} orders a takeaway`, orders[name]!);
  }

  console.log('\nGuests ask for things');
  for (const [room, item, count] of [['214', 'Extra towels', 2], ['210', 'Extra towels', 1]] as const) {
    if (await step(`room ${room} asks for ${item}`, () => amenity(browser, room, item, count)) !== null) {
      log(`room ${room} asks for ${count} × ${item.toLowerCase()}`);
    }
  }

  console.log('\nThe kitchen works');
  const kds = await step('the kitchen signs in', async () => {
    const page = await staff(browser, 'kitchen@thekesari.example');
    await page.goto(`${BASE}/kds`);
    return page;
  });
  if (kds) {
    const plan: Array<[string, string[], string]> = [
      ['214', ['Accept', 'Start cooking'], 'cooking'],
      ['210', ['Accept', 'Start cooking', 'Ready'], 'at the pass'],
      ['105', ['Accept', 'Start cooking', 'Ready'], 'at the pass'],
      ['Aman', ['Accept', 'Start cooking'], 'cooking'],
      ['301', [], 'left new'],
      ['Priya', [], 'left new'],
    ];
    for (const [who, buttons, outcome] of plan) {
      const number = orders[who];
      if (!number || !buttons.length) {
        if (number) log(`${who} (${number})`, outcome);
        continue;
      }
      if (await step(`kitchen moves ${who}`, () => kitchen(kds, number, buttons)) !== null) {
        log(`${who} (${number})`, outcome);
      }
    }
  }

  console.log('\nA runner takes a tray');
  await step('the runner takes room 210 up', async () => {
    const page = await staff(browser, 'runner@thekesari.example', { width: 390, height: 844 });
    await page.goto(`${BASE}/runner`);
    const tray = page.locator('li').filter({ hasText: orders['210'] ?? '210' }).first();
    await tray.getByRole('button', { name: 'Take it up' }).click();
    await page.waitForTimeout(1_200);
    log('runner took room 210 up', 'room 105 waits at the pass');
  });

  console.log('\nHousekeeping starts the shift');
  await step('housekeeping clocks in', async () => {
    const page = await staff(browser, 'housekeeping@thekesari.example', { width: 390, height: 844 });
    await page.goto(`${BASE}/housekeeping`);
    const clockIn = page.locator('summary', { hasText: 'Clock in' });
    if (await clockIn.count()) {
      await clockIn.first().click();
      const floors = page.locator('input[name="floorIds"]');
      for (let i = 0; i < await floors.count(); i += 1) await floors.nth(i).check();
      await page.getByRole('button', { name: 'Start the shift' }).click();
      await page.getByText(/On shift ·/).waitFor({ timeout: 120_000 });
    }
    log('housekeeping is on shift', 'every floor');
    const going = page.getByRole('button', { name: 'I am going' }).first();
    if (await going.count()) {
      await going.click();
      await page.waitForTimeout(1_200);
      log('housekeeping took a request');
    }
  });

  await browser.close();
  console.log('\nDone. Seeded requests already include some running late, so the');
  console.log('"late" states show without waiting. Orders turn late on their own');
  console.log('once they pass their promised time.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
