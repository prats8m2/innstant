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
} from './client';
export type { Tx, TenantContext, QrRouting } from './client';
export { recordEvent, readEventHistory } from './events';
export type { EventInput } from './events';
