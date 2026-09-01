import type { PmsAdapter } from './types';
import { ManualAdapter } from './manual';

export type { PmsAdapter, PmsEvent, PmsEventKind, PmsKind, StayRef } from './types';
export { ManualAdapter } from './manual';

/**
 * Which system of record owns this property's reservations.
 *
 * Always `ManualAdapter` today, and the lookup that will change that is
 * deliberately absent: a `properties.pms_provider` column is purely ADDITIVE,
 * and EXTENSION-POINTS' own rule is to keep only the changes that would need
 * data reconciled later and drop everything additive. A nullable text column
 * added the day a hotel actually runs Opera costs nothing; carrying it now would
 * be a setting nobody sets, read by a branch nobody takes.
 *
 * What matters is that every caller asks THIS function rather than assuming, so
 * the day the column exists there is one place to read it.
 */
export function pmsAdapterFor(input: { propertyId: string }): PmsAdapter {
  void input.propertyId;
  return ManualAdapter;
}

/**
 * For tests and for the drain worker, which is handed one rather than resolving
 * it per row.
 */
export function adapterByKind(kind: string): PmsAdapter | null {
  return kind === ManualAdapter.kind ? ManualAdapter : null;
}
