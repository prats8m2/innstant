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
  price: ApiMoney;
  isAvailable: boolean;
  /** 'VEGETARIAN', 'VEGAN', 'CONTAINS_NUTS', … — rendered as marks. */
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

export interface ApiMenu {
  outlet: ApiOutlet;
  sections: ApiMenuSection[];
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

/** `GET /api/v1/orders` — the list behind "your orders". */
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
