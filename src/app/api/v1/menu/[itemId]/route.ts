import { z } from 'zod';
import { getDish } from '@/modules/catalog';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { requireVisitSession } from '@/lib/api-auth';
import { apiHandler, corsPreflight } from '../../_lib/handler';
import { withVisitContext } from '../../_lib/context';
import { apiDish, apiMoney } from '../../_lib/serialise';
import type { ApiDishDetail } from '@/lib/api-contract';
import type { CurrencyCode } from '@/lib/money';

/**
 * `GET /api/v1/menu/{itemId}` — one dish, with the choices it carries. D-080.
 *
 * The modifier groups come with their min/max and their defaults, so the app
 * can preselect and can disable a send that does not satisfy a required group.
 * None of that is a guarantee: `addToCart()` re-validates every selection
 * against the dish's own groups, server side, because a selection arrives as a
 * request body and is exactly as trustworthy as anything else a client sends.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ItemId = z.uuid();

export const GET = apiHandler('/api/v1/menu/[itemId]', async (request): Promise<ApiDishDetail> => {
  const session = await requireVisitSession(request);

  /**
   * The id out of the path, rather than from a `params` argument.
   *
   * `apiHandler` wraps a one-argument function so that every route maps its
   * errors the same way, and Next's second `{ params }` argument is lost in
   * that wrapping. The path is right there on the request, and reading it is
   * one line against a route pattern that cannot change without this file
   * moving.
   */
  const segments = new URL(request.url).pathname.split('/');
  const parsed = ItemId.safeParse(segments.at(-1));
  if (!parsed.success) throw new ValidationError('That is not a dish.');

  return withVisitContext(session, async (tx, ctx) => {
    const detail = await getDish(tx, {
      propertyId: ctx.propertyId,
      itemId: parsed.data,
      // The property's clock decides whether this dish is on right now — a
      // breakfast dish opened at dinner reads as unavailable rather than
      // taking an order the kitchen will refuse.
      at: ctx.at,
    });

    // A dish id that is not on this property's menu: a stale link, a guessed
    // id, another hotel's dish. All the same 404.
    if (!detail) throw new NotFoundError('That dish is no longer on the menu.');

    const currency = detail.outlet.currency as CurrencyCode;

    return {
      dish: apiDish(detail.dish),
      outlet: ctx.apiOutlet,
      modifierGroups: detail.modifierGroups.map((group) => ({
        id: group.id,
        name: group.name,
        minSelections: group.minSelections,
        maxSelections: group.maxSelections,
        isRequired: group.isRequired,
        options: group.options.map((option) => ({
          id: option.id,
          name: option.name,
          priceDelta: apiMoney(option.priceDeltaMinor, currency),
          isAvailable: option.isAvailable,
          isDefault: option.isDefault,
        })),
      })),
    };
  });
});

/** Preflight. See the note on `corsPreflight`. */
export const OPTIONS = corsPreflight;
