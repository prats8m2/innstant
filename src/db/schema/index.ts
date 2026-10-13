/**
 * Barrel for drizzle-kit and for src/db only.
 *
 * Application code must NOT import from here — tables are module-private
 * (D-001) and the boundary lint rule enforces it. Call the owning module's
 * service function instead.
 */
export * from './_shared';
export * from './core';
export * from './identity';
export * from './stay';
export * from './visit';
export * from './access';
export * from './catalog';
export * from './ordering';
export * from './requests';
export * from './housekeeping';
export * from './billing';
export * from './concierge';
export * from './notifications';
/** Not a hotel's data — visitors who tried the demo. See demo.ts. */
export * from './demo';
