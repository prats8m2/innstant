import { z } from 'zod';
import { getMenu, searchMenu, menuFacets, countDishes } from '@/modules/catalog';
import { mostOrderedDishes } from '@/modules/ordering';
import { NotFoundError } from '@/lib/errors';
import { requireVisitSession } from '@/lib/api-auth';
import { apiHandler, corsPreflight, parseQuery } from '../../_lib/handler';
import { withVisitContext } from '../../_lib/context';
import { apiMenuFacets, apiMoney, apiSearchResult } from '../../_lib/serialise';
import type { ApiMenuSearch } from '@/lib/api-contract';

/**
 * `GET /api/v1/menu/search` — the menu, narrowed. Phase 3.
 *
 * ─── Why there is an endpoint for ten dishes ───────────────────────────────
 *
 * Because there are sixty at a real property, and because "does this dish
 * match" is a rule rather than a loop. See the note at the top of
 * `modules/catalog/menu-search.ts`: the folding, the tiers and what two
 * dietary chips mean together are decided once, on the server, with a test —
 * not three times in three clients.
 *
 * ─── The outlet is read, never passed ──────────────────────────────────────
 *
 * Same rule as `/api/v1/menu`, and for the same reason: it comes from the
 * SESSION, which got it from the link. A search that could name an outlet
 * would search a rooftop bar's menu through a cafe's link.
 *
 * This sits at `menu/search`, a static segment beside `menu/[itemId]`, and
 * Next resolves static before dynamic — so the word "search" can never be
 * mistaken for a dish id. Ids are UUIDs, so nothing is shadowed either way.
 *
 * CLAUDE.md #9 — browsing is never gated, and searching is browsing. The
 * session this needs is the one a bare link hands out with nothing asked.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * An absent parameter and an empty one are the same thing.
 *
 * An app clearing a chip sends `?minSpice=`, and answering that with a 422
 * would be punishing the client for the honest spelling of "no filter".
 */
const blankIsAbsent = (value: unknown) =>
  (value === '' || value === null ? undefined : value);

const wholeNumber = (max: number) => z.preprocess(
  blankIsAbsent,
  z.coerce.number().int().min(0).max(max).optional(),
);

/**
 * Comma-separated flags, upper-cased.
 *
 * Deliberately NOT validated against a list of known flags. `ApiDish`
 * declares the vocabulary open-ended — "a client renders the ones it knows
 * and drops the rest" — so a flag this server has never heard of is a filter
 * that matches nothing, which is the truthful answer, rather than a 422 that
 * breaks an older app the day a property invents a flag.
 */
const flagList = z.preprocess(
  blankIsAbsent,
  z.string().max(200).optional(),
).transform((value) => (
  value
    ? [...new Set(value.split(',').map((flag) => flag.trim().toUpperCase()).filter(Boolean))]
    : []
));

const QUERY = z.object({
  // 64 characters is longer than any dish on this menu. Past that it is not a
  // search, and the cap is what stops it being a way to spend the server's time.
  q: z.preprocess(blankIsAbsent, z.string().max(64).optional()),
  diet: flagList,
  excludeDiet: flagList,
  minSpice: wholeNumber(5),
  maxSpice: wholeNumber(5),
  // Minor units (#5), so the ceiling is a lakh rupees rather than a thousand.
  minPrice: wholeNumber(10_000_000),
  maxPrice: wholeNumber(10_000_000),
  limit: z.preprocess(blankIsAbsent, z.coerce.number().int().min(1).max(100).optional()),
});

/**
 * A ceiling, not a page size — there is no cursor and no second page.
 *
 * Every menu in this product fits under it today, and a results list somebody
 * flicks through once is not a place to introduce paging. `totalDishes` is
 * what tells an app it is looking at a truncation; if a property's menu ever
 * grows past this with no query typed, the honest fix is the SQL narrowing
 * the search module's note describes, not a cursor bolted to a relevance
 * ordering that is recomputed on every request.
 */
const DEFAULT_LIMIT = 100;

export const GET = apiHandler(
  '/api/v1/menu/search',
  async (request): Promise<ApiMenuSearch> => {
    const session = await requireVisitSession(request);
    const params = parseQuery(
      request,
      QUERY,
      'That search could not be read. Check the filters and try again.',
    );

    return withVisitContext(session, async (tx, ctx) => {
      // `ctx.at` is property-local: the collection windows and each dish's own
      // schedule are applied against the hotel's clock, exactly as the menu
      // read applies them, so a search cannot surface a dish the menu under it
      // has stopped showing.
      const menu = await getMenu(tx, {
        propertyId: ctx.propertyId,
        outletId: ctx.outletId,
        at: ctx.at,
      });
      if (!menu) throw new NotFoundError('This menu is no longer being served.');

      const ranks = await mostOrderedDishes(tx, { outletId: ctx.outletId });

      const hits = searchMenu(menu.sections, {
        query: params.q,
        filters: {
          dietaryFlags: params.diet,
          excludeDietaryFlags: params.excludeDiet,
          minSpice: params.minSpice ?? null,
          maxSpice: params.maxSpice ?? null,
          minPriceMinor: params.minPrice ?? null,
          maxPriceMinor: params.maxPrice ?? null,
        },
        limit: params.limit ?? DEFAULT_LIMIT,
      });

      const currency = ctx.outlet.currency;

      return {
        query: (params.q ?? '').trim(),
        // Echoed back AS APPLIED, so a chip row can render from the answer
        // rather than from its own pending state and the two cannot disagree.
        filters: {
          dietaryFlags: params.diet,
          excludeDietaryFlags: params.excludeDiet,
          minSpice: params.minSpice ?? null,
          maxSpice: params.maxSpice ?? null,
          minPrice: params.minPrice != null ? apiMoney(params.minPrice, currency) : null,
          maxPrice: params.maxPrice != null ? apiMoney(params.maxPrice, currency) : null,
        },
        // Over the WHOLE menu, not the hits: a filter sheet offers what the
        // menu has, not what the current query happened to leave standing.
        facets: apiMenuFacets(menuFacets(menu.sections), currency),
        results: hits.map((hit) => apiSearchResult(hit, ranks)),
        totalDishes: countDishes(menu.sections),
      };
    });
  },
);

/** Preflight. See the note on `corsPreflight`. */
export const OPTIONS = corsPreflight;
