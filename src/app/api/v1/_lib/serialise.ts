import { formatMoney, money, type CurrencyCode, type Money } from '@/lib/money';
import type {
  ApiMoney, ApiDish, ApiFeaturedDish, ApiMenuSection, ApiOutlet, ApiCart, ApiCartLine,
  ApiOrder, ApiOrderSummary, ApiReorder, ApiTrackStep, ApiVisit,
  ApiMenuFacets, ApiMenuSearchResult,
} from '@/lib/api-contract';
import type {
  FeaturedDish, MenuDish, MenuFacets, MenuSearchHit, MenuSection, OutletMenu,
} from '@/modules/catalog';
import type {
  Cart, CartLine, PlacedOrderDetail, OrderSummary, ReorderableOrder,
} from '@/modules/ordering';
import type { TrackView, TrackEta } from '@/modules/ordering';
import { orderStateFor, trackEta, trackProgress } from '@/modules/ordering';
import type { Visit } from '@/modules/visit';

/**
 * Domain types → the wire. D-080.
 *
 * ─── Why this is a layer rather than `return Response.json(cart)` ──────────
 *
 * Three reasons, and the third is the one that bites.
 *
 *   1. #5 — money is formatted HERE, by the server's one formatter, so the app
 *      never reimplements Indian digit grouping. See the note in api-contract.
 *   2. Dates cross as ISO-8601 strings. A `Date` through `JSON.stringify`
 *      already is one, but relying on that means a column typed as `Date` and
 *      arriving as a string (which `tx.execute` makes possible — it asserts
 *      rather than parses) serialises differently without anything noticing.
 *   3. A domain type is not a contract. `PlacedOrderDetail` gains a field the
 *      moment somebody needs one internally, and without this layer that field
 *      ships to every phone on the next deploy — including ones holding data
 *      nobody decided to publish. What crosses is what is written down here.
 */

export function apiMoney(value: Money): ApiMoney;
export function apiMoney(minor: number, currency: string): ApiMoney;
export function apiMoney(a: Money | number, b?: string): ApiMoney {
  const value: Money = typeof a === 'number'
    ? money(a, (b ?? 'INR') as CurrencyCode)
    : a;
  return {
    minor: value.amountMinor,
    currency: value.currency,
    text: formatMoney(value),
  };
}

/** Null stays null. `new Date(null)` is the epoch, which renders as 1970. */
export function iso(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * One dish, with its badge hung on it.
 *
 * `ranks` is a REQUIRED parameter rather than an optional one, and that is
 * the whole reason it is a parameter at all. `MenuDish` cannot carry the
 * rank: it belongs to catalog, the count comes from `order_items`, and a
 * module may not read another module's tables (D-001) — so the composition
 * happens here, in the one layer that is allowed to know both.
 *
 * Required, because the alternative defaults to "no badge" and the failure
 * mode of that is a screen that silently never shows one. Passing
 * `NO_RANKS` is a decision somebody made; forgetting an argument is not.
 *
 * It also rules out `section.items.map(apiDish)`, which would hand `apiDish`
 * the array index as its second argument.
 */
export type DishRanks = ReadonlyMap<string, number>;

/** For the reads where popularity is not part of the question. */
export const NO_RANKS: DishRanks = new Map();

export function apiDish(dish: MenuDish, ranks: DishRanks): ApiDish {
  return {
    id: dish.id,
    name: dish.name,
    description: dish.description,
    price: apiMoney(dish.priceMinor, dish.currency),
    listPrice: dish.listPriceMinor === null ? null : apiMoney(dish.listPriceMinor, dish.currency),
    offer: dish.offer,
    isAvailable: dish.isAvailable,
    dietaryFlags: dish.dietaryFlags,
    spiceLevel: dish.spiceLevel,
    prepTimeMinutes: dish.prepTimeMinutes,
    imageUrl: dish.imageUrl,
    blurhash: dish.blurhash,
    canQuickAdd: dish.canQuickAdd,
    // Absent is null, never 0: a dish nobody ordered has no rank, and zero
    // would sort to the top of anything that treated it as one.
    mostOrderedRank: ranks.get(dish.id) ?? null,
  };
}

export function apiSection(section: MenuSection, ranks: DishRanks): ApiMenuSection {
  return {
    id: section.id,
    kind: section.kind,
    title: section.title,
    label: section.label,
    blurb: section.blurb,
    items: section.items.map((dish) => apiDish(dish, ranks)),
  };
}

/**
 * The featured strip, from the domain's own pick.
 *
 * The dishes are re-serialised rather than referenced by id into `sections`,
 * which costs a few hundred bytes and buys a strip that renders from one field
 * instead of from a lookup the app has to get right. `apiDish` is the same
 * function `apiSection` uses, so the two views of a dish cannot drift.
 */
export function apiFeatured(
  entries: readonly FeaturedDish[],
  ranks: DishRanks,
): ApiFeaturedDish[] {
  return entries.map((entry) => ({
    section: entry.section,
    dish: apiDish(entry.dish, ranks),
  }));
}

/**
 * A search hit. The same `apiDish` again, for the same reason — a dish found
 * by searching and the same dish scrolled to must not differ by a field.
 */
export function apiSearchResult(hit: MenuSearchHit, ranks: DishRanks): ApiMenuSearchResult {
  return { section: hit.section, dish: apiDish(hit.dish, ranks) };
}

/**
 * The filter vocabulary, with the price ends formatted by the one formatter
 * (#5) — a slider's end caps are money a person reads, so they arrive as
 * "₹180" rather than as 18000 for the app to group digits a second way.
 */
export function apiMenuFacets(facets: MenuFacets, currency: string): ApiMenuFacets {
  return {
    dietaryFlags: facets.dietaryFlags,
    spiceLevels: facets.spiceLevels,
    priceRange: facets.priceRange
      ? {
        min: apiMoney(facets.priceRange.minMinor, currency),
        max: apiMoney(facets.priceRange.maxMinor, currency),
      }
      : null,
  };
}

export function apiOutlet(
  outlet: OutletMenu['outlet'],
  open: { line: string; isOpen: boolean; opensAt: string | null },
): ApiOutlet {
  return {
    id: outlet.id,
    name: outlet.name,
    prepTimeMinutes: outlet.prepTimeMinutes,
    isAcceptingOrders: outlet.isAcceptingOrders,
    minimumOrder: apiMoney(outlet.minimumOrderMinor, outlet.currency),
    openLine: open.line,
    isOpen: open.isOpen,
    opensAt: open.opensAt,
  };
}

export function apiVisit(visit: Visit): ApiVisit {
  return {
    id: visit.id,
    fulfilment: visit.fulfilment,
    tableLabel: visit.tableLabel,
    customerName: visit.customerName,
    customerPhone: visit.customerPhone,
    deliveryAddress: visit.deliveryAddress,
    expiresAt: iso(visit.expiresAt)!,
  };
}

function apiCartLine(line: CartLine, currency: CurrencyCode): ApiCartLine {
  return {
    id: line.id,
    menuItemId: line.menuItemId,
    name: line.name,
    unitPrice: apiMoney(line.unitPriceMinor, currency),
    // The no-op ones are filtered, exactly as the web cart filters them for
    // display and the receipt declines to carry them: "Ker sangri · Nothing"
    // is not worth a line on a screen.
    modifiers: line.modifiers
      .filter((m) => !m.isNoOp)
      .map((m) => ({
        optionId: m.optionId,
        name: m.name,
        priceDelta: apiMoney(m.priceDeltaMinor, currency),
      })),
    quantity: line.quantity,
    lineTotal: apiMoney(line.lineTotalMinor, currency),
    notes: line.notes,
    isAvailable: line.isAvailable,
    imageUrl: line.imageUrl,
  };
}

/**
 * The cart, with the minimum-order rule already applied.
 *
 * `shortfall` is computed server-side rather than sent as a raw minimum for
 * the app to subtract from. `placeOrder()` refuses below the minimum — it is
 * the money path and that is where the rule belongs — and an app doing its own
 * arithmetic to predict that refusal is a second copy of the rule, which is
 * how one of them starts disagreeing with the kitchen.
 */
export function apiCart(
  cart: Cart | null,
  minimumOrderMinor: number,
  currency: CurrencyCode,
): ApiCart {
  const zero = apiMoney(0, currency);
  const subtotalMinor = cart?.totals.subtotal.amountMinor ?? 0;
  const shortMinor = Math.max(0, minimumOrderMinor - subtotalMinor);

  if (!cart) {
    return {
      lines: [],
      totals: { subtotal: zero, tax: zero, serviceCharge: zero, deliveryFee: zero, total: zero },
      itemCount: 0,
      // No cart is not below the minimum — it is nothing at all, and an app
      // showing "₹500 to go" over an empty screen would be nagging somebody
      // who has not started.
      shortfall: null,
    };
  }

  return {
    lines: cart.lines.map((line) => apiCartLine(line, cart.currency)),
    totals: {
      subtotal: apiMoney(cart.totals.subtotal),
      tax: apiMoney(cart.totals.tax),
      serviceCharge: apiMoney(cart.totals.serviceCharge),
      deliveryFee: apiMoney(cart.totals.deliveryFee),
      total: apiMoney(cart.totals.total),
    },
    itemCount: cart.itemCount,
    shortfall: shortMinor > 0 ? apiMoney(shortMinor, currency) : null,
  };
}

function apiSteps(view: TrackView): ApiTrackStep[] {
  return (view.steps ?? []).map((step) => ({
    key: step.key,
    title: step.title,
    sub: step.sub,
    state: step.state.toUpperCase() as ApiTrackStep['state'],
    at: iso(step.at),
  }));
}

/**
 * One order, with its timeline already decided.
 *
 * `trackView` and `trackEta` run HERE rather than in the app. They are the
 * order state machine's presentation half, they are unit-tested, and a second
 * implementation in React Native would be a state machine nobody reviews
 * against the spec — the exact thing CLAUDE.md's "use a library" rule is
 * about, one layer up.
 */
export function apiOrder(
  order: PlacedOrderDetail,
  view: TrackView,
  eta: TrackEta | null,
  extra: { destination: string; fulfilment: ApiOrder['fulfilment']; paymentLine: string },
): ApiOrder {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status as ApiOrder['status'],
    destination: extra.destination,
    fulfilment: extra.fulfilment,

    lines: order.lines.map((line) => ({
      id: line.id,
      name: line.name,
      quantity: line.quantity,
      unitPrice: apiMoney(line.unitPriceMinor, order.currency),
      lineTotal: apiMoney(line.lineTotalMinor, order.currency),
      notes: line.notes,
      modifiers: line.modifiers.map((m) => ({
        name: m.name,
        priceDelta: apiMoney(m.priceDeltaMinor, order.currency),
      })),
    })),
    subtotal: apiMoney(order.subtotalMinor, order.currency),
    tax: apiMoney(order.taxMinor, order.currency),
    serviceCharge: apiMoney(order.serviceChargeMinor, order.currency),
    deliveryFee: apiMoney(order.deliveryFeeMinor, order.currency),
    total: apiMoney(order.totalMinor, order.currency),

    placedAt: iso(order.placedAt),
    promisedByAt: iso(order.promisedByAt),

    etaLabel: eta?.label ?? null,
    etaFrom: iso(eta?.from ?? null),
    etaTo: iso(eta?.to ?? null),
    steps: apiSteps(view),
    haltTitle: view.halt?.title ?? null,
    haltReason: view.halt?.reason ?? null,
    isLive: view.live,
    paymentLine: extra.paymentLine,
  };
}

/**
 * One order, as a list row and as the home screen's live card.
 *
 * The state machine's presentation half runs HERE too, for the same reason
 * `apiOrder` runs it: a card that says "Being cooked" and draws three of five
 * segments is reading the machine, and the only acceptable number of places
 * that machine is implemented is one. `OrderSummary` already carries the
 * stamps the lists select, so this costs no query and no second round trip —
 * which is the point, because the alternative was `GET /orders/{id}` per live
 * order just to learn one word.
 */
export function apiOrderSummary(order: OrderSummary, isLive: boolean): ApiOrderSummary {
  const state = orderStateFor(order.status);
  // The same three parts `apiOrder` sends, so a card and the tracking screen
  // compose one sentence the same way — and null together when there is
  // nothing honest to promise.
  const eta = trackEta(order.status, order.promisedByAt, { deliveredAt: order.deliveredAt });
  const progress = trackProgress(order.status);

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status as ApiOrderSummary['status'],
    total: apiMoney(order.totalMinor, order.currency),
    placedAt: iso(order.placedAt),
    summary: order.summary,
    itemCount: order.itemCount,
    isLive,

    statusLabel: state.label,
    headline: state.short,

    etaLabel: eta?.label ?? null,
    etaFrom: iso(eta?.from ?? null),
    etaTo: iso(eta?.to ?? null),

    stepIndex: progress.index,
    stepCount: progress.of,
  };
}

/**
 * Where the money changes hands, said plainly.
 *
 * There is no card screen and no folio (D-079), so an app that said nothing
 * here would leave somebody expecting a payment step that never comes. When
 * online payment arrives this is the sentence that changes.
 */
export function paymentLineFor(fulfilment: ApiOrder['fulfilment']): string {
  return fulfilment === 'DELIVERY' ? 'Pay the rider when it arrives.' : 'Pay at the counter.';
}

/**
 * The reorder block, for the home screen. D-080.
 *
 * `placedOn` is a DATE, not an instant: "12 Oct" is what the design prints
 * beside the order number, and it is rendered in the PROPERTY's timezone like
 * every other human-facing time in this product (CLAUDE.md "Dates"). An order
 * placed at 00:30 in Udaipur belongs to that day there, not to the previous
 * one in UTC.
 *
 * The lines themselves do not cross. The app shows one summary line and a
 * button; what goes in the cart is decided server-side when the button is
 * pressed, from the order, not from anything a client sends back.
 */
export function apiReorder(order: ReorderableOrder, timeZone: string): ApiReorder {
  return {
    orderId: order.orderId,
    orderNumber: order.orderNumber,
    placedOn: order.placedAt ? dayLabel(order.placedAt, timeZone) : '',
    summary: order.summary,
    total: apiMoney(order.totalMinor, order.currency),
  };
}

/** "12 Oct", there. */
function dayLabel(instant: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      timeZone,
    }).format(instant);
  } catch {
    // An unknown IANA zone throws rather than falling back, and a date one
    // zone out is still better than a 500 on a storefront.
    return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(instant);
  }
}
