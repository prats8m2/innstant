import Link from 'next/link';
import {
  Bell, ConciergeBell, House, Landmark, MapPin, MessageCircle, Package, Utensils,
  type LucideIcon,
} from 'lucide-react';
import styles from './room-home.module.css';

/**
 * The home's icons, from Lucide (D-073 — a library for a solved problem),
 * matched to the Midnight board's glyphs as closely as Lucide draws them.
 *
 * Tiles: the board's cloche is `ConciergeBell`, its hamper `Package`, its
 * arched gateway `Landmark`, and the bell is `Bell` — the same bell the call
 * for service screen leads with. 20px at the board's 1.5 stroke (1.6 on the
 * lit tile, as drawn).
 *
 * Decorative: every icon sits beside its own text label and never alone.
 */
export type TileIconName = 'dining' | 'amenities' | 'nearby' | 'service';

const ICONS: Record<TileIconName, LucideIcon> = {
  dining: ConciergeBell,
  amenities: Package,
  nearby: Landmark,
  service: Bell,
};

export function TileIcon({ name }: { name: TileIconName }) {
  const Icon = ICONS[name];
  return (
    <Icon size={20} strokeWidth={name === 'service' ? 1.6 : 1.5} aria-hidden="true" />
  );
}

/**
 * The dock's four tabs, each an existing screen: Stay is this one, Dining the
 * menu, Concierge the call for service, Explore plan my day. On the home only.
 */
const TABS: readonly { label: string; path: string; Icon: LucideIcon }[] = [
  { label: 'Stay', path: 'home', Icon: House },
  { label: 'Dining', path: 'menu', Icon: Utensils },
  { label: 'Concierge', path: 'service', Icon: MessageCircle },
  { label: 'Explore', path: 'nearby', Icon: MapPin },
];

export function DockNav({ base }: { base: string }) {
  return (
    <nav aria-label="Main" className={styles.tabs}>
      {TABS.map(({ label, path, Icon }) => (
        <Link
          key={path}
          href={`${base}/${path}`}
          className={styles.tab}
          aria-current={path === 'home' ? 'page' : undefined}
        >
          <Icon size={22} strokeWidth={1.6} aria-hidden="true" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
