/**
 * The `/api/v1` contract. D-080.
 *
 * ─── Why this file exists, and why it holds no runtime code ────────────────
 *
 * The mobile app imports these types directly (`import type`, always) so that a
 * changed response shape is a compile error in the app rather than a blank
 * screen on somebody's phone. Types are erased, so nothing in this file — and
 * nothing it could ever reach — ends up in the React Native bundle. Adding a
 * single runtime export here would drag the web app's module graph into Metro,
 * which is why there is not one: no constants, no helpers, no Zod schemas.
 *
 * ─── Why `/v1` ─────────────────────────────────────────────────────────────
 *
 * An app on somebody's phone cannot be redeployed. A guest who installed in
 * March is still running March's client in November, and the server has to keep
 * answering it — so the path is versioned from the first commit rather than
 * from the first breaking change, when it would be too late to add.
 *
 * The rule that follows: within a version, fields may be ADDED and may not be
 * removed, renamed, or have their meaning changed. A removal is a `/v2`.
 *
 * ─── Money crosses the wire pre-formatted ──────────────────────────────────
 *
 * #5 says format in exactly one place, with tabular figures and Indian digit
 * grouping — ₹1,150, not ₹1150 and never ₹1.15k. Sending only `minor` would
 * mean a second implementation of that in the app, which is how one of them
 * starts disagreeing. `minor` is still sent, because arithmetic and sorting
 * need it; `text` is what renders.
 */

export interface ApiMoney {
  /** Integer minor units (#5). For arithmetic, never for display. */
  minor: number;
  /** ISO-4217, on every amount (#5). */
  currency: string;
  /** Formatted by the server — "₹1,150". This is what a screen renders. */
  text: string;
}

/** Every failure, in one shape. `code` is stable; `message` is for a person. */
export interface ApiError {
  code: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION'
    | 'CONFLICT' | 'TOO_MANY_ATTEMPTS' | 'INTERNAL';
  /** Says what happened and what to do. Never apologises, never vague. */
  message: string;
}

/* ── The visit ───────────────────────────────────────────────────────────── */

export type ApiFulfilment = 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
export type ApiLinkKind = 'TABLE' | 'COUNTER' | 'ONLINE';

export interface ApiVisit {
  id: string;
  /** DINE_IN is fixed by the link; the other two are the customer's choice. */
  fulfilment: ApiFulfilment;
  /** Set only for a table tent — and then the app must not offer delivery. */
  tableLabel: string | null;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: string | null;
  /** ISO-8601. The app stops using its token at this point and re-opens. */
  expiresAt: string;
}

export interface ApiOutlet {
  id: string;
  name: string;
  /** What the app shows while somebody waits: "25–35 min". */
  prepTimeMinutes: number;
  isAcceptingOrders: boolean;
  /** Below this, the kitchen refuses — the cart says so before the tap. */
  minimumOrder: ApiMoney;
  /** Today's state in the PROPERTY's timezone: "Open until 11:30pm". */
  openLine: string;
  isOpen: boolean;
  /**
   * When ordering starts again — "noon", "7am" — or null.
   *
   * Set ONLY when the kitchen is shut, opens again later the SAME day, and has
   * not been stopped by hand. Those are the three conditions under which a
   * bare clock time is the whole truth:
   *
   *   · a reopening on another day is a sentence, not a time, and `openLine`
   *     already says it ("The kitchen opens Thursday at 7am");
   *   · a manager who threw `isAcceptingOrders` mid-service has not said when
   *     they will throw it back, and the week's schedule is not that answer.
   *
   * Null in every other case, and a screen that wants to print a time has
   * nothing to print rather than a guess. Formatted in the PROPERTY's
   * timezone by the one formatter that does it (`formatClock`).
   */
  opensAt: string | null;
}

export interface ApiProperty {
  id: string;
  name: string;
  city: string | null;
  /** Rendering happens here, but the app needs it for a relative time. */
  timezone: string;
}

/** `POST /api/v1/visits` and `GET /api/v1/visits/current`. */
export interface ApiSession {
  /** `<tenantId>.<token>` — sent back as `Authorization: Bearer …`.
   *  Present ONLY on the open response; `current` never re-issues it. */
  token?: string;
  visit: ApiVisit;
  outlet: ApiOutlet;
  property: ApiProperty;
  /** What the link itself is, which decides whether the app may ask about
   *  delivery at all. */
  linkKind: ApiLinkKind;
}

/* ── The menu ────────────────────────────────────────────────────────────── */

export interface ApiDish {
  id: string;
  name: string;
  description: string | null;
  /** What the guest pays for the dish: AFTER any live offer (D-085). */
  price: ApiMoney;
  /**
   * Added with D-085. The price before the offer, for a client to strike
   * through beside `price`; null when no offer applies. A client from before
   * this field shows `price` alone, which is still what is charged.
   */
  listPrice?: ApiMoney | null;
  /** Added with D-085. The offer that set `price`: "20% off", and its name. */
  offer?: { name: string; label: string } | null;
  /**
   * Added with D-086. Portions left today for a dish with a daily limit;
   * null for a dish without one. At 0, `isAvailable` is false too.
   */
  remainingToday?: number | null;
  isAvailable: boolean;
  /**
   * 'VEGETARIAN', 'NON_VEGETARIAN', 'VEGAN', 'CONTAINS_NUTS', … — rendered as
   * marks. Open-ended, so a client renders the ones it knows and drops the
   * rest rather than printing SCREAMING_SNAKE at somebody.
   *
   * The veg / non-veg pair is a DECLARATION and neither one is the default:
   * a dish carrying neither has had nothing said about it, and a client must
   * draw no mark rather than guess which square to print.
   */
  dietaryFlags: string[];
  spiceLevel: number | null;
  prepTimeMinutes: number | null;
  imageUrl: string | null;
  /** Rendered while the image loads, so a slow connection shows no grey box. */
  blurhash: string | null;
  /**
   * Whether the LIST can add this straight to the cart, or has to open it.
   *
   * False when a required choice has no default the kitchen is willing to
   * make. The app draws a stepper only where this is true — the same rule the
   * web menu follows, decided once in the menu read.
   */
  canQuickAdd: boolean;
  /**
   * 1 for the dish this outlet has sold most over the trailing month, 2 for
   * the next, and so on down a short shelf. Null — the usual answer — means
   * no badge, and it is what a new property, a quiet month and a dish nobody
   * orders all return.
   *
   * Counted from `order_items`, so it is the one piece of social proof in
   * this app that is EARNED rather than published about ourselves. It counts
   * orders rather than units (six chais on one tray is one table wanting
   * chai), and the server declines to rank at all until the outlet has enough
   * history for a ranking to mean anything. A client must therefore never
   * render a count, a percentage or a "top 10%" from this: the only honest
   * sentences it supports are "Most ordered" and "#2 most ordered".
   *
   * Ties share a rank, so two dishes may both be 2 and nothing is 3.
   */
  mostOrderedRank: number | null;
}

export interface ApiMenuSection {
  id: string;
  kind: 'COLLECTION' | 'CATEGORY';
  title: string;
  /** The short form for a horizontal rail — "Rooftop", not "From the rooftop". */
  label: string;
  blurb: string | null;
  items: ApiDish[];
}

/**
 * One entry of the home screen's featured strip.
 *
 * The SECTION LABEL travels with the dish because the strip tags each dish
 * with where it came from — "Rajasthani classics", "Chef Bhairav" — and
 * `ApiDish` carries no section of its own. An app walking `sections` to
 * find the tag would be re-deriving a choice the server already made, and
 * would get a different answer for a dish that appears in three of them.
 *
 * Chosen by `featuredDishes()` in modules/catalog, so the web home and the app
 * cannot disagree and so the rule has a unit test. Not an `is_featured` column
 * somebody ticks (D-071), and not a sales count — counting promotes ₹180 chai
 * over the ₹1,150 dish, which is not what "three to start with" is a place for.
 */
export interface ApiFeaturedDish {
  /** The `ApiMenuSection.label` this was taken from — the short form, which
   *  is what an eyebrow over a dish name has room for. */
  section: string;
  dish: ApiDish;
}

export interface ApiMenu {
  outlet: ApiOutlet;
  sections: ApiMenuSection[];
  /**
   * Up to three dishes, already picked. Empty when the outlet has nothing
   * available — the strip then renders nothing rather than an apology.
   *
   * Every dish here also appears in `sections`; this is a view of the same
   * payload rather than extra inventory, which is why there is no second
   * request for it.
   */
  featured: ApiFeaturedDish[];
}

/* ── Searching the menu (phase 3) ────────────────────────────────────────── */

/**
 * `GET /api/v1/menu/search` — one read that both searches and filters.
 *
 * ─── Why the filters are on the search and not beside it ──────────────────
 *
 * A diner types "paneer" and then taps "Veg", and the answer is one list.
 * Two endpoints would mean the app intersecting two result sets and owning
 * the ordering of the intersection, which is the search rule living in the
 * client again by another route.
 *
 * ─── Every parameter is optional, including the query ─────────────────────
 *
 * Tapping a filter chip with an empty box is a legitimate request — browse
 * the veg dishes — and it returns the whole filtered menu in menu order. A
 * request with nothing at all returns the whole menu, which makes this
 * endpoint's empty state the menu rather than a blank screen.
 *
 * The query string:
 *
 *   q             the typed text, up to 64 characters
 *   diet          comma-separated flags the dish must ALL carry
 *   excludeDiet   comma-separated flags the dish must carry NONE of
 *   minSpice      0-5, inclusive
 *   maxSpice      0-5, inclusive
 *   minPrice      integer MINOR units, inclusive (#5)
 *   maxPrice      integer MINOR units, inclusive (#5)
 *   limit         1-100, default 100
 *
 * An empty value is the same as an absent one, so an app clearing a chip may
 * send `?minSpice=` rather than rebuilding the query string. A repeated
 * parameter is NOT a list — `?diet=A&diet=B` keeps only the last; the two
 * flag fields are comma-separated for exactly that reason.
 *
 * Out of range is a 422, not a clamp, so `filters` below is always what was
 * asked for. Unknown dietary flags are the one exception: they are accepted
 * and match nothing, because `ApiDish.dietaryFlags` is open-ended and an
 * older app must not start failing the day a property invents a flag.
 */
export interface ApiMenuSearchResult {
  /**
   * Where the dish sits on the menu, in the short rail form — the eyebrow
   * over the name in a result row, the same string `ApiMenuSection.label`
   * and `ApiFeaturedDish.section` carry.
   *
   * A dish in three sections appears ONCE, under the first — which is the
   * editorial one, because collections precede categories.
   */
  section: string;
  dish: ApiDish;
}

/**
 * The filters as the server APPLIED them, echoed back.
 *
 * Not decoration: it is how a chip row proves it agrees with the list under
 * it. An unparseable or out-of-range parameter is a 422 rather than a silent
 * clamp, so what comes back here is what was asked for — but it comes back
 * normalised (flags upper-cased, blanks dropped), and an app that renders
 * from this rather than from its own pending state cannot show a chip the
 * results do not honour.
 */
export interface ApiMenuFilters {
  dietaryFlags: string[];
  excludeDietaryFlags: string[];
  minSpice: number | null;
  maxSpice: number | null;
  minPrice: ApiMoney | null;
  maxPrice: ApiMoney | null;
}

/**
 * What there is to filter BY on THIS menu — the chips a filter sheet may
 * offer and the ends of the price slider.
 *
 * Sent with every search so the sheet needs no second request, and taken from
 * the outlet's own dishes rather than from a constant: a "Vegan" chip on a
 * menu with no vegan dish can only ever reach the empty state, and a slider
 * whose range is not the menu's spends half its travel on nothing.
 *
 * Computed over every dish on the menu, including tonight's unavailable ones,
 * so the chip row does not move under somebody's thumb as the kitchen 86s a
 * dish.
 */
export interface ApiMenuFacets {
  /** Sorted, so the chip order is stable between requests. */
  dietaryFlags: string[];
  /** The levels actually declared, ascending. Empty when none are. */
  spiceLevels: number[];
  /** Null when the outlet is showing no dishes at all. */
  priceRange: { min: ApiMoney; max: ApiMoney } | null;
}

export interface ApiMenuSearch {
  /** What was actually searched, folded of nothing but surrounding space —
   *  so a results header can quote it back without re-trimming. */
  query: string;
  filters: ApiMenuFilters;
  facets: ApiMenuFacets;
  /** Best match first; with no query, available dishes in menu order. */
  results: ApiMenuSearchResult[];
  /**
   * How many dishes the outlet is showing before `query` and `filters` — so
   * an empty result can say "no match among 62 dishes" rather than implying
   * the kitchen has nothing.
   */
  totalDishes: number;
}

export interface ApiModifierOption {
  id: string;
  name: string;
  /** Signed — a modifier may reduce the price. */
  priceDelta: ApiMoney;
  isAvailable: boolean;
  isDefault: boolean;
}

export interface ApiModifierGroup {
  id: string;
  name: string;
  minSelections: number;
  maxSelections: number;
  isRequired: boolean;
  options: ApiModifierOption[];
}

/** `GET /api/v1/menu/{itemId}`. */
export interface ApiDishDetail {
  dish: ApiDish;
  modifierGroups: ApiModifierGroup[];
  outlet: ApiOutlet;
}

/* ── The cart ────────────────────────────────────────────────────────────── */

export interface ApiCartLineModifier {
  optionId: string;
  name: string;
  priceDelta: ApiMoney;
}

export interface ApiCartLine {
  id: string;
  menuItemId: string;
  name: string;
  unitPrice: ApiMoney;
  /** "Nothing" under an optional group is stored and not sent — it says
   *  nothing that its absence does not already say. */
  modifiers: ApiCartLineModifier[];
  quantity: number;
  lineTotal: ApiMoney;
  notes: string | null;
  /** The dish went off the menu while it sat here. Not in the total. */
  isAvailable: boolean;
  imageUrl: string | null;
}

export interface ApiCartTotals {
  subtotal: ApiMoney;
  tax: ApiMoney;
  serviceCharge: ApiMoney;
  deliveryFee: ApiMoney;
  total: ApiMoney;
}

/** `GET /api/v1/cart`. An empty cart and no cart at all are the same shape
 *  here on purpose — the app renders one empty state either way. */
export interface ApiCart {
  lines: ApiCartLine[];
  totals: ApiCartTotals;
  /** Sum of quantities — what the cart pill shows. */
  itemCount: number;
  /** How far short of the outlet's minimum, or null when it is met. The
   *  server computes it so the app never has to know the rule. */
  shortfall: ApiMoney | null;
}

/* ── Orders ──────────────────────────────────────────────────────────────── */

export type ApiOrderStatus =
  | 'PLACED' | 'ACCEPTED' | 'PREPARING' | 'READY'
  | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CLOSED'
  | 'REJECTED' | 'CANCELLED' | 'DISPUTED';

export interface ApiOrderLine {
  id: string;
  name: string;
  quantity: number;
  unitPrice: ApiMoney;
  lineTotal: ApiMoney;
  notes: string | null;
  modifiers: Array<{ name: string; priceDelta: ApiMoney }>;
}

/** One step on the tracking timeline, already decided by the server. */
export interface ApiTrackStep {
  key: string;
  title: string;
  sub: string;
  /** Upper-cased from the domain's own `TrackStepState`. */
  state: 'DONE' | 'ACTIVE' | 'PENDING';
  /** ISO-8601, or null for a step that has not happened. */
  at: string | null;
}

export interface ApiOrder {
  id: string;
  /** Quoted by the customer and printed on the ticket: "KE-1184". */
  orderNumber: string;
  status: ApiOrderStatus;
  /** Where it is going, as the kitchen reads it (#6, snapshotted at
   *  placement): "Table 4", "Delivery · 12 MG Road". */
  destination: string;
  fulfilment: ApiFulfilment;

  lines: ApiOrderLine[];
  subtotal: ApiMoney;
  tax: ApiMoney;
  serviceCharge: ApiMoney;
  deliveryFee: ApiMoney;
  total: ApiMoney;

  /** ISO-8601 throughout. The app renders in the property's timezone. */
  placedAt: string | null;
  promisedByAt: string | null;

  /** The headline — "Ready by 9:41pm" — and the steps under it. Both decided
   *  server-side, so the app never reimplements a state machine. */
  etaLabel: string | null;
  etaFrom: string | null;
  etaTo: string | null;
  steps: ApiTrackStep[];
  /** The kitchen's own words when it stops: why it was rejected or cancelled.
   *  Shown verbatim — what a kitchen types reaches the customer unedited. */
  haltTitle: string | null;
  haltReason: string | null;
  /** True while the status can still move on its own; false once it is
   *  finished. The app polls only while this is true. */
  isLive: boolean;
  /** Said plainly, because there is no card screen: "Pay at the counter". */
  paymentLine: string;
}

/**
 * `GET /api/v1/orders` — the list behind "your orders", and the home screen's
 * live-order card.
 *
 * ─── Why the last seven fields are here and not behind a second request ────
 *
 * A card that says "Being cooked · arriving between 9:29 and 9:41" used to
 * cost `GET /orders` and then `GET /orders/{id}` for every live order, purely
 * to learn one word and one sentence. They come off `orderStateFor()`,
 * `trackEta()` and `trackProgress()` — the same functions the detail endpoint
 * already runs, run once more in the serialiser — so the app still holds no
 * copy of the order state machine, and the home screen is one request.
 */
export interface ApiOrderSummary {
  id: string;
  orderNumber: string;
  status: ApiOrderStatus;
  total: ApiMoney;
  placedAt: string | null;
  /** "2× Laal maas · Masala chai" — the order at a glance. */
  summary: string;
  itemCount: number;
  isLive: boolean;

  /** The pill: "Being cooked". */
  statusLabel: string;
  /** The one-line headline over the card: "Your order is being cooked". */
  headline: string;

  /**
   * The ETA, in the three parts `ApiOrder` already sends, so a card and the
   * tracking screen render one sentence the same way.
   *
   * Null together when there is nothing honest to promise — a halted order, or
   * one placed before the outlet had a prep time.
   */
  etaLabel: string | null;
  etaFrom: string | null;
  etaTo: string | null;

  /**
   * How far along, as a fraction a card draws as segments.
   *
   * `stepIndex` is 1-based and 0 for anything not on the timeline: a halted
   * order, or a draft. `stepCount` is SENT rather than assumed, because the
   * timeline has five steps and not the six a status enum would suggest —
   * ACCEPTED and PREPARING are deliberately one step ("In the kitchen"), with
   * the difference carried in the sub-line. An app that hardcoded either
   * number would be holding half a state machine.
   */
  stepIndex: number;
  stepCount: number;
}

/* ── Requests ────────────────────────────────────────────────────────────── */

export interface ApiOpenVisitBody {
  /** The public code from `/p/{code}` — scanned, deep-linked or typed. */
  code: string;
}

/**
 * `POST /api/v1/cart/items` — a selection somebody MADE, on the dish screen.
 *
 * Leaving `modifierOptionIds` out is an empty selection, not "use the
 * defaults", and a dish with a required group refuses it. For the + on a menu
 * card, use `ApiQuickAddBody` below.
 */
export interface ApiAddToCartBody {
  menuItemId: string;
  quantity: number;
  notes?: string;
  modifierOptionIds?: string[];
}

/**
 * `POST /api/v1/cart/quick-add` — the + and − on a menu card.
 *
 * Fills in the kitchen's own defaults, which is a shortcut rather than a guess.
 * Only offer it where the dish says `canQuickAdd`; the minus knows which
 * variant to take from when the cart holds two of the same dish made
 * differently.
 */
export interface ApiQuickAddBody {
  menuItemId: string;
  direction: 'add' | 'remove';
}

export interface ApiPlaceOrderBody {
  /**
   * Minted by the app, stable per attempt (#8). Two taps of the same button
   * send the same key and place one order — the most common duplicate in this
   * product, and no less common on a pavement than in a room.
   */
  idempotencyKey: string;
  name: string;
  phone: string;
  fulfilment: ApiFulfilment;
  deliveryAddress?: string;
  deliveryNotes?: string;
  guestNotes?: string;
}

export interface ApiPlacedOrder {
  orderId: string;
  orderNumber: string;
  total: ApiMoney;
  /** True when this call found the order a previous attempt already placed. */
  wasAlreadyPlaced: boolean;
}

/**
 * "Same as last time" — the last delivered order, offered back. D-080.
 *
 * Sent ONLY when the whole order can be put in a cart again today: every dish
 * still on the menu, still available against the property's clock, every
 * modifier option still there. Null in every other case, and the block is not
 * drawn — the designer's "Hidden if any line is now unavailable", decided on
 * the server because that is where the menu is.
 *
 * `total` is what that order COST, not what it would cost now. It is a
 * reminder of a past receipt (#6) and is labelled as one; the cart that
 * `POST /api/v1/orders/reorder` fills is priced live, and the two are allowed
 * to differ.
 */
export interface ApiReorder {
  orderId: string;
  orderNumber: string;
  /** "12 Oct", in the PROPERTY's timezone. */
  placedOn: string;
  /** "2× Laal maas · Masala chai". */
  summary: string;
  total: ApiMoney;
}

/** `GET /api/v1/orders/reorder`. */
export interface ApiReorderSuggestion {
  reorder: ApiReorder | null;
}

/** `POST /api/v1/orders/reorder` — the cart, as it is now that the order is
 *  in it. The app replaces its copy and opens the cart. */
export interface ApiReorderResult {
  cart: ApiCart;
}

/**
 * `GET /api/v1/orders/again` — which dishes this history has eaten. Phase 2.
 *
 * Ids ONLY, deliberately. The app is already holding today's menu, and a
 * price, a photograph and whether a dish can be added blind all belong to it;
 * what the app cannot know is what somebody ate before. So the server answers
 * that one question and the app intersects the answer with the menu it has.
 *
 * The useful consequence: a dish that is off the menu tonight is not in the
 * menu payload, so it cannot appear in the rail. There is no second
 * availability check here to fall out of step with the first.
 *
 * Newest first, and capped — this draws a rail, not a history.
 */
export interface ApiOrderedBefore {
  menuItemIds: string[];
}


/* ── Customer accounts (D-081) ───────────────────────────────────────────── */

/**
 * The second credential.
 *
 * `Authorization: Bearer <context>` keeps meaning WHERE somebody is ordering
 * from — a visit. This header means WHO THEY ARE, and the two are independent:
 * a request may carry neither (anonymous browsing, #9), the context alone
 * (today's behaviour), both (a signed-in customer at a table), or the customer
 * alone (order history, before anything has been scanned).
 *
 * The context kept `Authorization` specifically so the APK already installed
 * does not break. `/v1` is versioned because a client on somebody's phone
 * cannot be redeployed, and that promise starts applying from the first
 * shipped build rather than at the first convenient moment.
 */
export const CUSTOMER_TOKEN_HEADER = 'x-customer-token';

export interface ApiCustomer {
  /** `COALESCE(display_name, full_name)`. What they call themselves — never
   *  what the front desk recorded, which a customer may not rewrite. */
  name: string;
  phone: string | null;
  email: string | null;
  /** Proved by OTP, as opposed to typed into a form by somebody. */
  phoneVerified: boolean;
}

export interface ApiAddress {
  id: string;
  /** "Home", "Work", "Mum's". Theirs to choose. */
  label: string;
  /** One free-text line: an Indian address is a landmark and a floor as often
   *  as a street. The rider reads it; nothing parses it. */
  line: string;
  notes: string | null;
  isDefault: boolean;
}

/** `POST /api/v1/auth/otp/request`. */
export interface ApiRequestOtpBody {
  phone: string;
}

/**
 * Always `{ sent: true }`, for every dialable number.
 *
 * It does NOT report whether a message was actually sent. A throttled number
 * answers identically to a fresh one, and a number that has never ordered here
 * answers identically to one that has — otherwise this endpoint tells anybody
 * who asks whether a given person is a customer of this hotel group.
 */
export interface ApiRequestOtpResult {
  sent: true;
  /** How long the code is good for, so the screen can say so. */
  expiresInMinutes: number;
}

/** `POST /api/v1/auth/otp/verify`. */
export interface ApiVerifyOtpBody {
  phone: string;
  code: string;
  /** Used only if this is a brand-new customer. Never overwrites a name the
   *  front desk recorded. */
  name?: string;
}

export interface ApiSignedIn {
  /** Sent back as `X-Customer-Token` on every later request. */
  token: string;
  customer: ApiCustomer;
  addresses: ApiAddress[];
}

/** `GET /api/v1/auth/me` — the cold-start check for the customer half. */
export interface ApiMe {
  customer: ApiCustomer;
  addresses: ApiAddress[];
}

export interface ApiUpdateProfileBody {
  name?: string;
  email?: string | null;
}

export interface ApiAddressBody {
  label: string;
  line: string;
  notes?: string | null;
  isDefault?: boolean;
}
