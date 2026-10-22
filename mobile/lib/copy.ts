/**
 * The home screen's own prose. D-080.
 *
 * ─── Why this is a constant and not a column ───────────────────────────────
 *
 * Every sentence here is about one restaurant on one screen: the hero line,
 * the card that says no account is needed, the notice shown when the kitchen
 * is shut, the two footer lines. The alternative was a `tagline` on
 * `properties` or `outlets`, and a column added for one sentence on one screen
 * is a column every property then has to fill in and every migration has to
 * carry.
 *
 * It is defensible because of D-080: the app is ONE restaurant's app, baked
 * against one link code, and a build for another property is a different
 * build. If a second one ever installs, `properties.branding` is the runtime
 * hook that already exists — this file is what it would be read into, not a
 * thing that would have to be unpicked first.
 *
 * What is deliberately NOT here: anything the server already said. The opening
 * line, the prep time, the minimum, an order's status and its ETA all arrive
 * composed and are rendered verbatim. The app writes its own voice only where
 * there is no server sentence to render.
 */

export const HOME_COPY = {
  /** The eyebrow over the arch. Where the kitchen is, not what it sells. */
  heroEyebrow: 'Rooftop · Udaipur',

  /** Two headlines, chosen by `outlet.isOpen` and nothing else. */
  heroHeadlineOpen: 'Cooked on the roof. Sent to your door.',
  heroHeadlineClosed: 'The fires are out until noon.',

  /**
   * Under the hero photograph, before the dish it is of. Phase 2.
   *
   * "Pictured" rather than "Featured" or "Tonight's special": the photograph
   * is of one real dish and the line says which, which is the whole claim
   * being made. A stronger word would be the app recommending something the
   * server did not pick for that reason — `featured[0]` is the first of three,
   * not a dish of the day.
   */
  heroCaption: 'Pictured',

  /** The "Order again" rail, drawn only from dishes somebody actually ate
   *  and which are on the menu today. */
  againTitle: 'Order again',
  againEyebrow: 'You have had these',

  featuredTitle: 'Three to start with',
  /** The right-hand eyebrow on the featured header. */
  featuredEyebrow: 'Tonight',

  contentsTitle: 'The menu',

  /** The reorder block. Shown only when the server offered one — see
   *  `ApiReorder`, where "hidden if any line is unavailable" is decided. */
  reorderEyebrow: 'Same as last time',
  reorderAction: 'Reorder',

  /** #9, said out loud. A statement, not a control — it is not tappable. */
  noAccountTitle: 'No account needed',
  noAccountBody:
    'Read the menu, fill a cart, order. If you sign in at the cart, we keep your address and your past orders.',

  /** Shown only while `outlet.isOpen` is false. It explains; it does not act,
   *  and it does not stop anybody reading or filling a cart (#9). */
  closedTitle: 'We are not taking orders right now.',
  closedBody:
    'Read the menu and fill a cart. It will be here at noon, and you can place it then.',

  footerLocality: 'The Kesari · Udaipur, Rajasthan',
  footerFulfilment: 'Delivery or pickup from the hotel gate.',

  /** The bottom bar's two faces. The cart face composes its own count. */
  ctaBrowse: 'See the full menu',
  ctaBrowseClosed: 'Read the menu',
  ctaCart: 'View cart',
  /** The closed bar's right-hand figure, in front of the server's own clock
   *  time: "Ordering opens noon". The hour is never the app's to invent — if
   *  `outlet.opensAt` is null this sentence is not shown at all. */
  ctaOpensAt: 'Ordering opens',
} as const;

/**
 * The search tab's own prose. Phase 3.
 *
 * Here for the same reason `HOME_COPY` is: these are sentences about one
 * restaurant's menu on one screen, and none of them is a thing the server
 * said. What the server says — a refusal, a price, an opening line — is
 * still rendered verbatim and is not in this file.
 */
export const SEARCH_COPY = {
  /** Inside the field. It names what is searched, not what to do. */
  placeholder: 'Search the menu',

  /** Before anything is typed and before any chip is lit. */
  idleTitle: 'What are you after?',
  idleBody:
    'Search by name or by what is in it — “laal maas”, “kachori”, “ghee”. Or use the filters above.',

  recentTitle: 'Recent',
  recentClear: 'Clear all',

  /**
   * Appended to an empty result, when the server told us how many dishes the
   * outlet is actually showing.
   *
   * "Nothing matched" on its own reads as a kitchen with no food in it. The
   * count turns it into what it really is — a search that was too narrow —
   * and the server returns `totalDishes` precisely so this sentence can be
   * written without a second request.
   */
  emptyOutOf: (n: number) => `There ${n === 1 ? 'is' : 'are'} ${n} ${n === 1 ? 'dish' : 'dishes'} on the menu today.`,

  /**
   * Nothing matched. Composed with the term by the screen, because a quoted
   * term in the middle of a sentence is the part that makes the sentence
   * useful — "Nothing matched" alone reads as an error.
   */
  emptyLead: 'Nothing on the menu matches',
  /** Said only when chips are lit, because then there is something to undo. */
  emptyFiltered: 'The filters may be doing it. Clear them and look again.',
  emptyPlain: 'Try a shorter word, or a part of one.',
} as const;
