/**
 * The site's copy, in one place.
 *
 * Separated from the markup for the ordinary reason — a marketing page is 80%
 * words, and mixing them into JSX makes both harder to change — and for one
 * specific to this file: several of these claims are about how the PRODUCT
 * works, and they have to stay true. The security section in particular says
 * things a reader could check: that the app connects as a role without
 * BYPASSRLS, that guest tokens are hashed, that the event log is append-only.
 * All three are CLAUDE.md non-negotiables (#2, #10, #7) rather than
 * aspirations, which is the only reason they are allowed on a sales page.
 *
 * If one of those invariants ever changes, this file is part of the blast
 * radius.
 */

export interface Pillar {
  kicker: string;
  title: string;
  body: string;
  foot: string;
  /** The little shape in the corner — a door, a tile, a ring. */
  shape: 'arch' | 'square' | 'ring';
}

export const PILLARS: Pillar[] = [
  {
    kicker: 'For the guest',
    title: 'Ask for anything without picking up the phone.',
    body: 'Dinner with modifiers, extra towels, an iron, someone from the desk, a later checkout, where to eat nearby. Every request confirms instantly and shows its live state.',
    foot: 'No app, no login, no waiting on hold',
    shape: 'arch',
  },
  {
    kicker: 'For your teams',
    title: 'Kitchen, runners, housekeeping and the desk, in sync.',
    body: 'One order lands as a ticket, a pickup, a delivery and a folio line, each on the screen of the person who needs it. Nothing is relayed by radio or sticky note.',
    foot: 'Kitchen display, staff phones, desk console',
    shape: 'square',
  },
  {
    kicker: 'For the owner',
    title: 'Every interaction priced, timed and on the record.',
    body: 'Service charge, delivery fee, late checkout tiers and taxes are configured once and applied every time. Promise times are measured. The event log settles arguments.',
    foot: 'Revenue you were leaving in the room',
    shape: 'ring',
  },
];

export interface Step {
  who: string;
  time: string;
  title: string;
  body: string;
}

/** One order, followed across all four surfaces. The times are one evening. */
export const STEPS: Step[] = [
  {
    who: 'Guest',
    time: '21:40',
    title: 'Scans the QR on the nightstand.',
    body: 'The link already knows room 214, Anjali, and that she checks out Thursday. No login screen, no verification until the first charge.',
  },
  {
    who: 'Guest',
    time: '21:41',
    title: 'Orders laal maas and two lassis in three taps.',
    body: 'Modifiers, quantity, a note for the runner. The cart pill morphs as items land. Sent to room 214, charged to the folio.',
  },
  {
    who: 'Kitchen',
    time: '21:41',
    title: 'The ticket is on the pass display before she puts the phone down.',
    body: 'It pulses until someone acknowledges it. Accept starts the prep timer; reject sends the reason straight back to the guest.',
  },
  {
    who: 'Runner',
    time: '22:09',
    title: 'Kishan’s phone buzzes when the kitchen bumps it.',
    body: 'He sees the note: no bell after 10, please knock. Picked up, delivered, done. The guest watched every state on her phone.',
  },
  {
    who: 'Front desk',
    time: '22:10',
    title: '₹2,266 is on the folio before the plates are cleared.',
    body: 'Devika sees the line, the timestamps and who delivered it. At checkout it settles with everything else, one receipt.',
  },
];

export interface RevenueCard {
  stat: string;
  statLabel: string;
  title: string;
  body: string;
}

export const REVENUE: RevenueCard[] = [
  {
    stat: '+38%',
    statLabel: 'in-room dining orders',
    title: 'Ordering without a phone call',
    body: 'Guests order more when they can browse a menu with pictures and prices at their own pace, at 11pm, without speaking to anyone.',
  },
  {
    stat: '₹2,500',
    statLabel: 'average late checkout fee',
    title: 'Late checkout as a product',
    body: 'Tiered fees the guest requests themselves. The desk approves in one click when the room is free. It used to be a shrug.',
  },
  {
    stat: '6×',
    statLabel: 'more amenity requests logged',
    title: 'Chargeable amenities, visibly priced',
    body: 'Laundry, airport cars, a bottle of wine. In one list next to free towels, each with a promise time.',
  },
  {
    stat: '10%',
    statLabel: 'service charge, applied every time',
    title: 'Nothing forgotten at the desk',
    body: 'Service charge, delivery fees and taxes are configured once. Every order carries them. Every one reconciles.',
  },
];

export interface Theme {
  key: string;
  name: string;
  sub: string;
  place: string;
  bg: string;
  accent: string;
  ink: string;
}

/**
 * The six demonstration palettes. Real values from the design system, because
 * the claim the section makes — that a second hotel is a palette swap and not a
 * layout fork — is D-016, and showing six invented swatches would undercut it.
 */
export const THEMES: Theme[] = [
  { key: 'heritage',  name: 'The Kesari',   sub: 'Heritage haveli',   place: 'Udaipur · 34-key converted haveli',   bg: '#101E33', accent: '#E9A227', ink: '#E3E5DB' },
  { key: 'coast',     name: 'Aramaya',      sub: 'Beach resort',      place: 'South Goa · 60-key beach resort',     bg: '#F7F2E7', accent: '#2F6B4F', ink: '#2E3A33' },
  { key: 'corporate', name: 'Node',         sub: 'Business hotel',    place: 'Bengaluru · 180-key business hotel',  bg: '#F2F4F7', accent: '#1F5FD8', ink: '#14181D' },
  { key: 'gallery',   name: 'Hôtel Verre',  sub: 'Art hotel',         place: 'Colaba, Mumbai · 22-key art hotel',   bg: '#211F1C', accent: '#B08D3F', ink: '#EDE8E0' },
  { key: 'forest',    name: 'Deodar House', sub: 'Wellness lodge',    place: 'Kasauli · 18-key wellness lodge',     bg: '#E8EBE5', accent: '#8A6A43', ink: '#27302A' },
  { key: 'transit',   name: 'Stack',        sub: 'Airport pod hotel', place: 'Delhi Aerocity · 240-key budget hotel', bg: '#101112', accent: '#E4FF3F', ink: '#F2F3F0' },
];

export interface SecurityItem {
  kicker: string;
  badge: string;
  /** `strong` renders the badge in navy-on-gold; `quiet` is the outline form. */
  badgeTone: 'strong' | 'gold' | 'quiet';
  title: string;
  body: string;
}

export const SECURITY: SecurityItem[] = [
  {
    kicker: 'Isolation',
    badge: 'Proven by test',
    badgeTone: 'strong',
    title: 'Row-level security in Postgres',
    body: 'The application connects as a role that owns no tables and cannot bypass RLS. Every query runs inside a tenant context. A cross-tenant read returns nothing, and a test in our suite tries every session.',
  },
  {
    kicker: 'Guest sessions',
    badge: 'Tiered',
    badgeTone: 'gold',
    title: 'Access follows the stay, not an account',
    body: 'A QR scan issues a request-tier session tied to the room and the active stay. The first charge escalates it with one verification prompt. Tokens are hashed at rest and revoked at checkout.',
  },
  {
    kicker: 'Staff access',
    badge: '8 roles',
    badgeTone: 'quiet',
    title: 'Resource-action permissions',
    body: 'Every staff action is authorised against a resource and an action, not a page. Roles are seeded per property; a kitchen login cannot see folios, a runner cannot edit menus.',
  },
  {
    kicker: 'Validation',
    badge: 'Every boundary',
    badgeTone: 'quiet',
    title: 'Nothing enters unchecked',
    body: 'Every request body, every environment variable and every webhook is validated with a schema before a line of business logic runs.',
  },
  {
    kicker: 'Payments',
    badge: 'Razorpay',
    badgeTone: 'quiet',
    title: 'Card data never touches us',
    body: 'Settlement runs through Razorpay. We store a reference and an amount. Orders are idempotent, so a retried request cannot charge twice.',
  },
  {
    kicker: 'Audit',
    badge: 'Append-only',
    badgeTone: 'quiet',
    title: 'An event log nobody can edit',
    body: 'Every status change writes a row in the same transaction that made it, to a table with UPDATE and DELETE revoked. It is the SLA record and the dispute record at once.',
  },
];

export interface Quote {
  text: string;
  name: string;
  role: string;
  initials: string;
  /**
   * The avatar, in the palette of the property this person works at.
   *
   * Real values, set inline in the markup, for the same reason the theme
   * swatches below are: they ARE somebody else's colours, and reading them
   * from a token would quietly show the reader this site's instead.
   */
  avatarBg: string;
  avatarInk: string;
}

export const QUOTES: Quote[] = [
  {
    text: '“Our night kitchen used to take orders on a landline with the fryer running. Now the ticket is on the screen before the guest has put the phone down.”',
    name: 'Bhairav Singh',
    role: 'Head chef, The Kesari, Udaipur',
    initials: 'BS',
    avatarBg: '#101E33',
    avatarInk: '#E9A227',
  },
  {
    text: '“Late checkout was a favour we did for free, because arguing about ₹2,000 at the desk felt cheap. Now guests ask in the app and pay without a conversation.”',
    name: 'Devika Sharma',
    role: 'Front office manager, The Kesari',
    initials: 'DS',
    avatarBg: '#E9A227',
    avatarInk: '#101E33',
  },
  {
    text: '“I chose it because the guest app looked like our hotel and not like a food-delivery clone. Our guests notice that kind of thing. So do I.”',
    name: 'Rhea D’Souza',
    role: 'Owner, Aramaya, South Goa',
    initials: 'RD',
    avatarBg: '#2F6B4F',
    avatarInk: '#F7F2E7',
  },
];

/** The nav, and the anchors it points at. */
export const NAV = [
  { href: '#product', label: 'Product' },
  { href: '#themes', label: 'Themes' },
  { href: '#security', label: 'Security' },
  { href: '#contact', label: 'Contact' },
] as const;
