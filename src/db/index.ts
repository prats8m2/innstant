/**
 * The public surface of the database layer.
 *
 * Note what is NOT here: the pool, the drizzle instance, and
 * `withoutTenantForProvisioning`. Application code gets withTenant() and the
 * types it needs to write a service, and nothing that can bypass a tenant
 * check (CLAUDE.md #1).
 */
export {
  withTenant,
  pingDatabase,
  readMigrationState,
  closePool,
  resolveQrRouting,
  slaSweepProperties,
} from './client';
export type { Tx, TenantContext, QrRouting, SweepTarget } from './client';
export { subscribeToChannel, closeNotifyConnection, notifyStatus } from './notify';
export type { Subscription } from './notify';
export { recordEvent, readEventHistory } from './events';
export type { EventInput } from './events';
