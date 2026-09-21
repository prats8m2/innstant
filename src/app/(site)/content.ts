/**
 * The site's copy, in one place.
 *
 * Separated from the markup for the ordinary reason — a marketing page is 80%
 * words, and mixing them into JSX makes both harder to change.
 *
 * ─── Who this is written for ───────────────────────────────────────────────
 *
 * An owner or a general manager, reading on a laptop, deciding whether to give
 * us twenty minutes. Not an engineer. An earlier version of this file said
 * "row-level security in Postgres", "resource-action permissions", "orders are
 * idempotent" and "append-only event log" — all true, all meaningless to the
 * person who signs. Every one of those is now a sentence about what it means
 * for their hotel, and the mechanism is left for the call.
 *
 * The claims still have to BE true, which is the constraint that makes this
 * harder than it looks. "One hotel cannot see another" is the guarantee
 * CLAUDE.md #1 and #2 enforce; "a guest never makes an account" is #9 and #10;
 * "an order cannot be charged twice" is #8; "nothing can be quietly edited
 * afterwards" is #7. Say it plainly, but do not say more than the code does.
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
    body: 'Dinner, extra towels, an iron, somebody from the desk, a later checkout, somewhere to eat nearby. Every request is confirmed on the spot, and they can see how far along it is without asking again.',
    foot: 'No app, no login, no waiting on hold',
    shape: 'arch',
  },
  {
    kicker: 'For your teams',
    title: 'Kitchen, runners, housekeeping and the desk, in sync.',
    body: 'One order becomes a kitchen ticket, a pickup, a delivery and a line on the bill — each appearing on the screen of the person who needs it. Nothing gets relayed by radio, shouted down a corridor, or written on a pad.',
    foot: 'A kitchen screen, staff phones, and the front desk',
    shape: 'square',
  },
  {
    kicker: 'For the owner',
    title: 'Every interaction priced, timed and on the record.',
    body: 'Service charge, delivery fees, late checkout rates and taxes are set once and applied every time. You can see how long each request took. And there is a record of everything, which is what settles an argument at the desk.',
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
    body: 'The page already knows it is room 214, that Anjali is in it, and that she leaves on Thursday. Nothing to install, nothing to sign into.',
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
    title: 'The ticket is on the kitchen screen before she puts the phone down.',
    body: 'It keeps flashing until somebody picks it up. Accepting starts the clock. If the sole is off tonight, the chef says so and the guest reads it in her own words, not from a phone call.',
  },
  {
    who: 'Runner',
    time: '22:09',
    title: 'Kishan’s phone buzzes when the kitchen bumps it.',
    body: 'He sees her note — no bell after 10, please knock. Picked up, delivered, done. She watched each step happen on her phone without ringing anyone.',
  },
  {
    who: 'Front desk',
    time: '22:10',
    title: '₹2,266 is on the folio before the plates are cleared.',
    body: 'Devika can see the line, the times and who carried it up. At checkout it settles with everything else, on one bill.',
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
    kicker: 'Separation',
    badge: 'Tested every release',
    badgeTone: 'strong',
    title: 'One hotel can never see another',
    body: 'Your guests, your orders and your bills sit behind a wall the software itself cannot step over — not a setting somebody could switch off by mistake. We test that wall on every release by trying to break it.',
  },
  {
    kicker: 'Your guests',
    badge: 'No accounts',
    badgeTone: 'gold',
    title: 'Nobody signs up for anything',
    body: 'A guest scans the code by the bed and they are in. No app to install, no password, no email address collected. Their access lasts exactly as long as their stay and stops at checkout.',
  },
  {
    kicker: 'Your team',
    badge: '8 roles',
    badgeTone: 'quiet',
    title: 'Everyone sees only their own job',
    body: 'The kitchen sees tickets. A runner sees deliveries. Only the front desk sees a bill. Eight roles arrive already set up, and moving somebody between them takes one click.',
  },
  {
    kicker: 'Money',
    badge: 'Never twice',
    badgeTone: 'quiet',
    title: 'A guest cannot be charged twice',
    body: 'Double-tapping “Place order” on slow hotel wifi is the single most common thing that happens in this product. It makes one order and one charge, every time, however many times the button is pressed.',
  },
  {
    kicker: 'Payments',
    badge: 'Razorpay',
    badgeTone: 'quiet',
    title: 'Card details never reach us',
    body: 'Money is taken by Razorpay, who hold the card. We keep the amount and a reference so it reconciles against the folio, and nothing else.',
  },
  {
    kicker: 'The record',
    badge: 'Permanent',
    badgeTone: 'quiet',
    title: 'Every action is on the record',
    body: 'Who accepted the order, who carried it up, who approved the late checkout, and at what minute. None of it can be quietly changed afterwards — which is exactly what makes it worth having when a guest disputes a line on their bill.',
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

/**
 * The nav, and the anchors it points at.
 *
 * Themes is not here. The section existed and was pulled: six palette swatches
 * are a claim about the product's flexibility that the site cannot yet back up
 * with a second live property, and a nav item pointing at six coloured
 * rectangles promises a page that is not there. `THEMES` stays — the six names
 * are still the logo strip — and the section can come back when there is a
 * hotel behind one of them.
 */
/**
 * The section headings and ledes.
 *
 * Here rather than inline in the markup because they are the ARGUMENT, and the
 * argument should be readable end to end without opening a component. Written
 * for an owner: what it does for the hotel, never how it is built.
 */
export const SECTIONS = {
  product: {
    kicker: 'What it is',
    title: 'Everything a guest asks for between check-in and checkout, on the phone they already have.',
  },
  how: {
    kicker: 'How it works',
    title: 'From the guest’s phone to the kitchen in about a second.',
    lede: 'One order, four screens, no phone calls. Every step is written down as it happens, so nothing gets lost between a guest, a runner and the front desk.',
  },
  revenue: {
    kicker: 'Revenue',
    title: 'Every request becomes a line on the bill, not a favour at the desk.',
    lede: 'Hotels leave money in the room because ordering means a phone call, late checkout is a shrug and the spa is a leaflet. Innstant turns each of those into something the guest does themselves — priced, timed and charged to the room.',
  },
  security: {
    kicker: 'Trust',
    title: 'Your guests’ data is yours. Your neighbour’s is theirs.',
    lede: 'Innstant runs many hotels on one system, and each one is walled off from the rest. Not by a policy somebody has to remember — by the way it is built.',
  },
  contact: {
    kicker: 'Book a demo',
    title: 'Twenty minutes, on your phone, with your own menu.',
    lede: 'Tell us the property and we set it up with your name, your rooms and your outlets before the call. You scan, you order, your team watches it land.',
  },
} as const;

export const NAV = [
  { href: '#product', label: 'Product' },
  { href: '#security', label: 'Security' },
  { href: '#contact', label: 'Contact' },
] as const;
