import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import * as schema from './schema';

/**
 * The database client. CLAUDE.md #1.
 *
 * ─── How the safety here is layered ────────────────────────────────────────
 *
 * S3b asks whether unscoped access should be prevented by an ESLint rule or a
 * runtime guard. The answer is neither, primarily: **the pool is never
 * exported.** Encapsulation beats both, because there is nothing to forget and
 * nothing to lint — the unsafe object is not reachable from application code.
 * A lint rule can be disabled inline; an unexported binding cannot be imported.
 *
 * Three layers, weakest last:
 *
 *   1. ENCAPSULATION (primary) — `pool` and `db` are module-private. The only
 *      exported way to reach Postgres is withTenant().
 *   2. LINT (secondary) — `pg` and `drizzle-orm/node-postgres` may only be
 *      imported inside `src/db/**`, so nobody can quietly construct a second
 *      pool that bypasses this file. Enforced in eslint.config.mjs.
 *   3. RLS (the real backstop) — even if 1 and 2 were both defeated, the
 *      policies in 0001_rls.sql make an unscoped query return zero rows rather
 *      than another hotel's data. Verified, not assumed.
 *
 * Layer 3 is the one that actually holds the guarantee. 1 and 2 exist so that
 * a mistake surfaces as a compile error rather than as an empty page in
 * production.
 */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. It must point at the app_user role through the ' +
      'transaction pooler — never the owner role, which would silently bypass ' +
      'RLS (CLAUDE.md #2).',
  );
}

/**
 * Module-private on purpose — see the note above.
 *
 * There is no external pooler (D-022) — this IS the pool. D-002's persistent
 * Node process means it is created once per process rather than per request,
 * which is the thing serverless cannot do. `max` is kept modest because
 * Postgres spends roughly 10MB per connection and idle ones are pure cost.
 */
const pool = new pg.Pool({
  connectionString,
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  // Railway requires TLS; its proxy certificate is not in the system CA store.
  ssl: { rejectUnauthorized: false },
  statement_timeout: Number(process.env.DATABASE_STATEMENT_TIMEOUT_MS ?? 15_000),
});

pool.on('error', (err) => {
  // An idle client erroring must not take the process down — Railway restarts
  // Postgres during maintenance and the pool recovers on its own.
  console.error(JSON.stringify({ level: 'error', msg: 'idle db client error', err: err.message }));
});

const db = drizzle(pool, { schema, casing: 'snake_case' });

/**
 * The transaction handle domain services receive.
 *
 * Services take a `Tx`, never the pool — that is what makes CLAUDE.md #7
 * possible: a status change and its `event_log` row are written in the SAME
 * transaction because they are handed the same object.
 */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface TenantContext {
  tenantId: string;
  /** Optional. Narrows a staff session to one property; guest sessions always
   *  have it. Policies read it where a table is property-scoped. */
  propertyId?: string;
}

/**
 * Matches what POSTGRES accepts as a uuid, not what RFC 4122 blesses. An
 * earlier version enforced the version and variant nibbles and rejected
 * `1111...-1111`, which is every seed fixture and any id minted by a system
 * that does not use v4. The guard exists to stop an empty or malformed string
 * reaching set_config — where '' would be silently turned into "match
 * nothing" by the policy's nullif (D-020) — not to police uuid provenance.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, field: string): void {
  if (!UUID_RE.test(value)) {
    // set_config takes a string, so a malformed id would otherwise reach the
    // policy as text and fail there with an opaque cast error — or, worse,
    // as an empty string, which nullif() turns into "match nothing".
    throw new TypeError(`${field} must be a UUID, received ${JSON.stringify(value)}`);
  }
}

/**
 * Every database access goes through here. CLAUDE.md #1.
 *
 * Opens a transaction and sets `app.tenant_id` / `app.property_id`, which the
 * RLS policies read.
 *
 * `set_config(..., true)` — the `true` is `is_local`, scoping the setting to
 * this transaction. Never a bare `SET`. There is no PgBouncer (D-022), but the
 * rule is unchanged and still load-bearing: THIS pool reuses connections across
 * requests, so a session-scoped setting would leak from one guest's request
 * into the next request that picks up that connection. A cross-tenant leak with
 * no error attached to it (CLAUDE.md #3).
 *
 * Note that after the transaction commits the GUC reverts to the EMPTY STRING,
 * not to unset — which is why every policy wraps it in `nullif(..., '')`. See
 * D-020; without that, a query outside this helper fails with a cast error
 * instead of returning nothing.
 */
export async function withTenant<T>(
  ctx: TenantContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  assertUuid(ctx.tenantId, 'tenantId');
  if (ctx.propertyId !== undefined) assertUuid(ctx.propertyId, 'propertyId');

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true)`);
    if (ctx.propertyId !== undefined) {
      await tx.execute(sql`SELECT set_config('app.property_id', ${ctx.propertyId}, true)`);
    }
    return fn(tx);
  });
}

/**
 * Migrations and the provisioning of a brand-new tenant are the only writes
 * that legitimately have no tenant context yet — you cannot set app.tenant_id
 * to a tenant that does not exist.
 *
 * This is NOT an escape hatch for request-handling code. It is named to be
 * greppable and it is not exported from src/db/index.ts.
 */
export async function withoutTenantForProvisioning<T>(
  reason: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!reason.trim()) throw new Error('A reason is required — it is written to the log.');
  console.warn(JSON.stringify({ level: 'warn', msg: 'unscoped db access', reason }));
  return db.transaction(fn);
}

/**
 * The one pre-tenant lookup in the request path (0003_qr_routing.sql).
 *
 * A guest at /r/{publicCode} has no cookie and no tenant, so this cannot run
 * inside withTenant(). It calls a SECURITY DEFINER function that returns
 * ROUTING IDS ONLY — tenant, property, room, and the code's own state. No
 * guest, stay or folio data crosses this boundary; everything downstream runs
 * through withTenant() with the tenant this returns.
 *
 * Lives here rather than in its own module because this file is the only place
 * allowed to touch the pool, and that restriction is the point.
 */
export interface QrRouting {
  tenantId: string;
  propertyId: string;
  roomId: string;
  qrCodeId: string;
  version: number;
  revokedAt: Date | null;
}

export async function resolveQrRouting(publicCode: string): Promise<QrRouting | null> {
  // Shape check before touching the database — this URL is public and will be
  // crawled, probed and fuzzed.
  if (!publicCode || publicCode.length > 64 || !/^[A-Za-z0-9_-]+$/.test(publicCode)) {
    return null;
  }

  const { rows } = await pool.query<{
    tenant_id: string; property_id: string; room_id: string;
    qr_code_id: string; version: number; revoked_at: Date | null;
  }>('SELECT * FROM resolve_qr_routing($1)', [publicCode]);

  const row = rows[0];
  if (!row) return null;
  return {
    tenantId: row.tenant_id,
    propertyId: row.property_id,
    roomId: row.room_id,
    qrCodeId: row.qr_code_id,
    version: row.version,
    revokedAt: row.revoked_at,
  };
}

/** For graceful shutdown and for tests. */
export async function closePool(): Promise<void> {
  await pool.end();
}

/** Health check only — deliberately does not expose the pool itself. */
export async function pingDatabase(): Promise<{ ok: boolean; latencyMs: number }> {
  const started = Date.now();
  try {
    await pool.query('SELECT 1');
    return { ok: true, latencyMs: Date.now() - started };
  } catch {
    return { ok: false, latencyMs: Date.now() - started };
  }
}
