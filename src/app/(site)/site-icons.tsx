import {
  ArrowRight,
  BedDouble,
  Bike,
  CalendarClock,
  ChefHat,
  Clock,
  Compass,
  ConciergeBell,
  CreditCard,
  IndianRupee,
  Mail,
  Monitor,
  Percent,
  Play,
  QrCode,
  ReceiptText,
  Repeat,
  Rocket,
  ScrollText,
  Shield,
  ShoppingBag,
  Smartphone,
  SquareStack,
  Tablet,
  Timer,
  UtensilsCrossed,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

/**
 * The marketing site's icon vocabulary.
 *
 * ─── Why a name and not a component in `content.ts` ────────────────────────
 *
 * The copy lives in `content.ts`, which is a `.ts` file on purpose — the
 * argument should be readable end to end without JSX in the way. A mark is
 * part of that argument now (half the page explains itself with a picture
 * rather than a paragraph), so the copy names its icon as a string and this
 * file is the one place that turns a string into a component.
 *
 * The practical payoff is that nothing in `content.ts` can import from
 * `lucide-react`, so the set of marks the site uses is exactly the list below
 * — countable, and reviewable against the design in one screen.
 *
 * ─── The dependency ────────────────────────────────────────────────────────
 *
 * Same argument as the guest home's `tile-icon.tsx`, which made it first and
 * at more length (D-073): Lucide is per-icon ESM, Next has it in
 * `optimizePackageImports`, and the marks below cost roughly a kilobyte
 * shipped. Hand-drawing thirty of them is the thing that rule exists to stop.
 *
 * ─── Accessibility ─────────────────────────────────────────────────────────
 *
 * Every mark on this page sits beside its own words — a chip's label, a card's
 * heading, a step's role. None of them carries meaning on its own, so they are
 * `aria-hidden` without exception and a screen reader hears the page it would
 * have heard before any of this was added.
 */
export type SiteIconName =
  | 'arrow'
  | 'bed'
  | 'calendar'
  | 'card'
  | 'cart'
  | 'clock'
  | 'desk'
  | 'dining'
  | 'folio'
  | 'kitchen'
  | 'linen'
  | 'mail'
  | 'nearby'
  | 'once'
  | 'percent'
  | 'phone'
  | 'play'
  | 'qr'
  | 'record'
  | 'roles'
  | 'rupee'
  | 'runner'
  | 'screen'
  | 'setup'
  | 'shield'
  | 'tablet'
  | 'timer'
  | 'wallet';

/**
 * Where a mark is also used inside the product, it is the SAME mark.
 *
 * `ConciergeBell` is the guest app's service screen, `SquareStack` its
 * amenities tile, `ReceiptText` its folio, `Compass` its nearby list. A
 * visitor who clicks through to the demo should recognise the thing they were
 * just reading about, which is the only reason to care which bell it is.
 */
const ICONS: Record<SiteIconName, LucideIcon> = {
  arrow: ArrowRight,
  bed: BedDouble,
  calendar: CalendarClock,
  card: CreditCard,
  cart: ShoppingBag,
  clock: Clock,
  desk: ConciergeBell,
  dining: UtensilsCrossed,
  folio: ReceiptText,
  kitchen: ChefHat,
  linen: SquareStack,
  mail: Mail,
  nearby: Compass,
  once: Repeat,
  percent: Percent,
  phone: Smartphone,
  play: Play,
  qr: QrCode,
  record: ScrollText,
  roles: Users,
  rupee: IndianRupee,
  runner: Bike,
  screen: Monitor,
  setup: Rocket,
  shield: Shield,
  tablet: Tablet,
  timer: Timer,
  wallet: Wallet,
};

/** A single mark. */
export function SiteIcon({
  name,
  size = 20,
  className,
}: {
  name: SiteIconName;
  size?: number;
  className?: string;
}) {
  const Icon = ICONS[name];
  return (
    // `absoluteStrokeWidth` holds the stroke at 1.75px whatever the box is, so
    // a 28px mark in a pillar and a 14px one in a chip read as one family
    // rather than as a bold and a hairline version of the same drawing.
    <Icon
      size={size}
      strokeWidth={1.75}
      absoluteStrokeWidth
      className={className}
      aria-hidden="true"
      focusable="false"
    />
  );
}
