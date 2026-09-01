import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenant } from '@/db';
import {
  getInRoomDiningOutlet, getMenu, getDish, seedMenu,
  KESARI_MENU, KESARI_CATEGORIES, KESARI_COLLECTIONS, KESARI_MODIFIER_GROUPS,
} from '@/modules/catalog';
import { ownerClient, seedTenant, cleanup, TENANT_A, TENANT_B, type Fixture } from './setup';

/**
 * Wednesday 21:00 property-local, passed to every menu read.
 *
 * The collection windows are applied now (`isWithinWindow`), so a menu read
 * without a time is a menu read at an unknown hour — and "After 10pm" is
 * seeded 22:00–01:00. 21:00 keeps it hidden and every other section showing,
 * whatever the clock on the machine running the suite says.
 */
const AT_NINE_PM = { dayOfWeek: 3, minutes: 21 * 60 };


/**
 * The menu, read the way the guest screen reads it.
 *
 * These run against a real Postgres as app_user, under RLS — which is the only
 * way to prove the thing that matters here: the query has no `tenant_id` in its
 * WHERE clause anywhere, because the policy supplies it. If withTenant() were
 * ever dropped from the page, this is what would fail.
 */
describe('menu read', () => {
  let owner: pg.Client;
  let a: Fixture;
  let b: Fixture;

  beforeAll(async () => {
    owner = ownerClient();
    await owner.connect();
    await cleanup(owner);
    a = await seedTenant(owner, TENANT_A, 'A');
    b = await seedTenant(owner, TENANT_B, 'B');

    // The real Kesari menu, so the assertions below are about actual data and
    // not vacuously true against an outlet with no dishes.
    await withTenant({ tenantId: a.tenantId, propertyId: a.propertyId }, (tx) =>
      seedMenu(tx, {
        tenantId: a.tenantId,
        propertyId: a.propertyId,
        outletId: a.outletId,
        categories: KESARI_CATEGORIES,
        items: KESARI_MENU,
        collections: KESARI_COLLECTIONS,
        modifierGroups: KESARI_MODIFIER_GROUPS,
      }));
  });

  afterAll(async () => {
    await cleanup(owner);
    await owner.end();
  });

  it('finds the in-room dining outlet for the property', async () => {
    const outlet = await withTenant({ tenantId: a.tenantId, propertyId: a.propertyId }, (tx) =>
      getInRoomDiningOutlet(tx, a.propertyId));

    expect(outlet).not.toBeNull();
    expect(outlet!.id).toBe(a.outletId);
  });

  it('returns the outlet with its money configuration intact', async () => {
    const menu = await withTenant({ tenantId: a.tenantId, propertyId: a.propertyId }, (tx) =>
      getMenu(tx, { propertyId: a.propertyId, outletId: a.outletId, at: AT_NINE_PM }));

    expect(menu).not.toBeNull();
    // #5 — every amount is integer minor units and rates are basis points, so
    // the screen never has to know how to round.
    expect(Number.isInteger(menu!.outlet.taxRateBps)).toBe(true);
    expect(Number.isInteger(menu!.outlet.serviceChargeBps)).toBe(true);
    expect(Number.isInteger(menu!.outlet.deliveryFeeMinor)).toBe(true);
    expect(menu!.outlet.currency).toBe('INR');
  });

  it('cannot read another tenant’s outlet, even with its id', async () => {
    // The id is real and correct — and the policy still returns nothing,
    // because the tenant context says otherwise. This is the whole guarantee.
    const menu = await withTenant({ tenantId: a.tenantId, propertyId: a.propertyId }, (tx) =>
      getMenu(tx, { propertyId: b.propertyId, outletId: b.outletId, at: AT_NINE_PM }));

    expect(menu).toBeNull();
  });

  it('leads with the curated collections, then the categories', async () => {
    const menu = await withTenant({ tenantId: a.tenantId, propertyId: a.propertyId }, (tx) =>
      getMenu(tx, { propertyId: a.propertyId, outletId: a.outletId, at: AT_NINE_PM }));

    const kinds = menu!.sections.map((s) => s.kind);
    const firstCategory = kinds.indexOf('CATEGORY');
    // The menu browses editorially — that is the design, not an accident of
    // ordering. Every collection precedes every category.
    expect(kinds.lastIndexOf('COLLECTION')).toBeLessThan(firstCategory);

    const titles = menu!.sections.map((s) => s.title);
    // "After 10pm" is NOT here at nine o'clock — it is seeded 22:00–01:00, and
    // the window is honoured now. See the test below.
    expect(titles.slice(0, 2)).toEqual([
      'From the rooftop', 'Chef Bhairav\u2019s table',
    ]);
  });

  it('shows a time-boxed collection only inside its window', async () => {
    const at = (hhmm: string) => {
      const [h, m] = hhmm.split(':').map(Number) as [number, number];
      return { dayOfWeek: 3, minutes: h * 60 + m };
    };
    const titlesAt = async (hhmm: string) => {
      const menu = await withTenant({ tenantId: a.tenantId, propertyId: a.propertyId }, (tx) =>
        getMenu(tx, { propertyId: a.propertyId, outletId: a.outletId, at: at(hhmm) }));
      return menu!.sections.map((s) => s.title);
    };

    /**
     * "After 10pm" is seeded with `available_from: '22:00'` and
     * `available_until: '01:00'`. Those two columns were written by the seeder
     * and IGNORED by this read for months, so the collection appeared at
     * breakfast — the same bug `outlet_hours` had.
     */
    expect(await titlesAt('09:00')).not.toContain('After 10pm');
    expect(await titlesAt('21:59')).not.toContain('After 10pm');
    expect(await titlesAt('22:00')).toContain('After 10pm');
    expect(await titlesAt('23:30')).toContain('After 10pm');
    // Past midnight, because the window says so.
    expect(await titlesAt('00:30')).toContain('After 10pm');
    expect(await titlesAt('01:00')).not.toContain('After 10pm');

    // And an unbounded collection is unaffected either way.
    expect(await titlesAt('09:00')).toContain('From the rooftop');
    expect(await titlesAt('23:30')).toContain('From the rooftop');
  });

  it('shortens section titles for the rail the way the reference does', async () => {
    const menu = await withTenant({ tenantId: a.tenantId, propertyId: a.propertyId }, (tx) =>
      getMenu(tx, { propertyId: a.propertyId, outletId: a.outletId, at: AT_NINE_PM }));

    const label = (title: string) => menu!.sections.find((s) => s.title === title)?.label;
    expect(label('From the rooftop')).toBe('Rooftop');
    expect(label('Chef\u2019s specials')).toBe('Chef\u2019s specials');
    expect(label('Chef\u2019s specials')).not.toBe('Chef');
  });

  it('renders a dish in two collections without duplicating the section', async () => {
    const menu = await withTenant({ tenantId: a.tenantId, propertyId: a.propertyId }, (tx) =>
      getMenu(tx, { propertyId: a.propertyId, outletId: a.outletId, at: AT_NINE_PM }));

    // "From the rooftop" is both a category name and a collection name in this
    // menu. Rendering both gives two identical headings and two identical rail
    // chips; the collection wins.
    const rooftop = menu!.sections.filter((s) => s.title === 'From the rooftop');
    expect(rooftop).toHaveLength(1);
    expect(rooftop[0]!.kind).toBe('COLLECTION');

    // Laal maas is deliberately in two collections — that is native to the
    // design, and it must appear in both sections.
    const laal = menu!.sections.filter((s) =>
      s.items.some((i) => i.name.startsWith('Laal maas')));
    expect(laal.map((s) => s.title)).toContain('From the rooftop');
    expect(laal.map((s) => s.title)).toContain('Chef Bhairav\u2019s table');
  });

  it('never returns an empty section', async () => {
    const menu = await withTenant({ tenantId: a.tenantId, propertyId: a.propertyId }, (tx) =>
      getMenu(tx, { propertyId: a.propertyId, outletId: a.outletId, at: AT_NINE_PM }));

    // An empty heading with a blurb under it reads as a loading failure, not
    // as an empty collection.
    for (const section of menu!.sections) {
      expect(section.items.length, `section "${section.title}" is empty`).toBeGreaterThan(0);
    }
  });

  it('gives every section a distinct rail label', async () => {
    const menu = await withTenant({ tenantId: a.tenantId, propertyId: a.propertyId }, (tx) =>
      getMenu(tx, { propertyId: a.propertyId, outletId: a.outletId, at: AT_NINE_PM }));

    // Two identical chips in the rail are indistinguishable to tap.
    const labels = menu!.sections.map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  describe('one dish', () => {
    const laal = 'Laal maas with bajra roti';

    async function dishNamed(name: string) {
      return withTenant({ tenantId: a.tenantId, propertyId: a.propertyId }, async (tx) => {
        const menu = await getMenu(tx, { propertyId: a.propertyId, outletId: a.outletId, at: AT_NINE_PM });
        const item = menu!.sections.flatMap((s) => s.items).find((i) => i.name === name);
        return item ? getDish(tx, { propertyId: a.propertyId, itemId: item.id }) : null;
      });
    }

    it('comes back with its modifier groups in order', async () => {
      const detail = await dishNamed(laal);

      expect(detail).not.toBeNull();
      expect(detail!.dish.name).toBe(laal);
      expect(detail!.modifierGroups.map((g) => g.name)).toEqual(['Chilli', 'Add a roti']);
    });

    it('marks exactly one default per required group', async () => {
      const detail = await dishNamed(laal);

      for (const group of detail!.modifierGroups) {
        const defaults = group.options.filter((o) => o.isDefault);
        // The screen preselects the default; two of them, or none in a
        // required group, and the guest is looking at an ambiguous form.
        expect(defaults, `group "${group.name}"`).toHaveLength(1);
      }

      const chilli = detail!.modifierGroups.find((g) => g.name === 'Chilli')!;
      // The heat IS the dish — a guest opts DOWN from what the chef cooks,
      // never in to it.
      expect(chilli.options.find((o) => o.isDefault)!.name).toBe('As the chef makes it');
      expect(chilli.isRequired).toBe(true);
    });

    it('prices its extras as signed minor units', async () => {
      const detail = await dishNamed(laal);
      const add = detail!.modifierGroups.find((g) => g.name === 'Add a roti')!;

      expect(add.isRequired).toBe(false);
      expect(add.options.find((o) => o.name === 'Nothing')!.priceDeltaMinor).toBe(0);
      // ₹90 (#5 — integer minor units, never a float).
      expect(add.options.find((o) => o.name === 'Extra bajra roti')!.priceDeltaMinor).toBe(9_000);
    });

    it('gives a sweet the serving group and no chilli question', async () => {
      const detail = await dishNamed('Kesar lassi');
      expect(detail!.modifierGroups.map((g) => g.name)).toEqual(['Serve it']);
    });

    it('shares one modifier group across every dish that carries it', async () => {
      // Reuse is the whole reason menu_item_modifier_groups exists rather than
      // a column on the item: renaming "Chilli" renames it in seven places.
      const [laalDetail, soleDetail] = await Promise.all([
        dishNamed(laal),
        dishNamed('Rooftop grilled river sole'),
      ]);

      const laalChilli = laalDetail!.modifierGroups.find((g) => g.name === 'Chilli')!;
      const soleChilli = soleDetail!.modifierGroups.find((g) => g.name === 'Chilli')!;
      expect(soleChilli.id).toBe(laalChilli.id);
    });

    it('cannot be read from another tenant’s property', async () => {
      const laalDetail = await dishNamed(laal);
      const leaked = await withTenant({ tenantId: b.tenantId, propertyId: b.propertyId }, (tx) =>
        getDish(tx, { propertyId: b.propertyId, itemId: laalDetail!.dish.id }));

      expect(leaked).toBeNull();
    });
  });
});