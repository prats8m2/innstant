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
  /** Untenanted platform data — the demo guest book only. See client.ts. */
  withPlatformWrite,
  pingDatabase,
  readMigrationState,
  closePool,
  resolveQrRouting,
  /** The property-link twin — /p/[code]. See client.ts. */
  resolveVisitLink,
  slaSweepProperties,
} from './client';
export type { Tx, TenantContext, QrRouting, VisitLinkRouting, SweepTarget } from './client';
export { subscribeToChannel, closeNotifyConnection, notifyStatus } from './notify';
export type { Subscription } from './notify';
export { recordEvent, readEventHistory } from './events';

/** `integration_outbox` — what we still owe an external system (D-019, §8). */
export {
  enqueueOutbox, pendingOutbox, markOutboxDelivered, markOutboxFailed,
  outboxBackoffSeconds, OUTBOX_MAX_ATTEMPTS,
} from './outbox';
export type { OutboxEntry, PendingOutboxRow } from './outbox';
export type { EventInput } from './events';
