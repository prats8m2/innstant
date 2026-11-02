import { Bell, House, MapPin, SquareStack, type LucideIcon } from 'lucide-react';
import styles from './room-home.module.css';

/**
 * One icon per tile, from Lucide (D-073 — a library for a solved problem).
 *
 * Direction A draws them as plain line icons in the accent, 24px at a 1.5
 * stroke, on the tile's top-left corner. Three are the board's own marks —
 * `Bell` for service, `House` for the stay, `MapPin` for the day out — and the
 * service screen leads with the same bell, so the tile and the screen it
 * opens are recognisably one thing.
 *
 * Amenities keeps `SquareStack`, folded linen stacked. The board's mark is a
 * closed box with a handle, which reads as luggage; `HandPlatter` was tried
 * long ago and sat as a dome beside the bell's dome.
 *
 * Decorative: every icon sits beside its own text label and never alone.
 */
export type TileIconName = 'amenities' | 'service' | 'stay' | 'nearby';

const ICONS: Record<TileIconName, LucideIcon> = {
  amenities: SquareStack,
  service: Bell,
  stay: House,
  nearby: MapPin,
};

export function TileIcon({ name }: { name: TileIconName }) {
  const Icon = ICONS[name];
  return <Icon className={styles.tileIcon} size={24} strokeWidth={1.5} aria-hidden="true" />;
}
