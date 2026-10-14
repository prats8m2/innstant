import { and, eq, gt, isNull } from 'drizzle-orm';
import { withTenant, recordEvent, type Tx } from '@/db';
import { customerSessions } from '@/db/schema/customer';
import { issueToken, hashToken } from '@/lib/tokens';
import type { CustomerAuthMethod } from './types';

/**
 * A signed-in customer. D-081.
 *
 * The second of this product's two guest-side credentials, and the whole
 * reason it is separate from `guest_sessions` is written at the top of
 * `src/db/schema/customer.ts`: that one says WHERE somebody is ordering from
 * and expires with the context; this one says WHO THEY ARE and lasts weeks.
 *
 * ─── The rule, restated because it is the one that matters ─────────────────
 *
 * **This grants ZERO access to any context.** Nothing in this file returns an
 * access tier, and nothing downstream may consult it as one. A customer
 * session unlocks the profile, the addresses and the history — things that
 * belong to the ACCOUNT. It never unlocks a folio, a stay, a checkout or
 * anybody's room, because proving a phone number is not proving you are the
 * person in 214. That is D-012's job and it stays there.
 */

export const CUSTOMER_TOKEN_HEADER = 'x-customer-token';

/**
 * Thirty days.
 *
 * Long, deliberately: this is a food-ordering app and asking somebody to sign
 * in again every week is how an account stops being worth having. It is safe
 * to be long because the row is the session — signing out, or a staff member
 * revoking, kills it immediately, which a stateless token could not promise.
 */
export const CUSTOMER_SESSION_DAYS = 30;

export interface CustomerSession {
  id: string;
  tenantId: string;
  guestId: string;
  expiresAt: Date;
}

/** `<tenantId>.<token>` — the same envelope the guest cookie uses, for the
 *  same reason: the tenant id is routing information, not a credential, and
 *  RLS confines the lookup regardless. */
export interface IssuedCustomerSession {
  session: CustomerSession;
  token: string;
}

export async function issueCustomerSession(
  tx: Tx,
  input: {
    tenantId: string;
    guestId: string;
    method: CustomerAuthMethod;
    ipAddress?: string | null;
    userAgent?: string | null;
  },
): Promise<IssuedCustomerSession> {
  const { token, tokenHash } = issueToken();
  const expiresAt = new Date(Date.now() + CUSTOMER_SESSION_DAYS * 24 * 60 * 60 * 1000);

  const [row] = await tx.insert(customerSessions).values({
    tenantId: input.tenantId,
    guestId: input.guestId,
    tokenHash,
    method: input.method,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    expiresAt,
  }).returning({ id: customerSessions.id });

  await recordEvent(tx, {
    tenantId: input.tenantId,
    // An account is tenant-wide and belongs to no property. The event log
    // wants one anyway, so it takes the guest's own id as the entity and
    // leaves the property out rather than inventing one.
    entityType: 'customer_session',
    entityId: row!.id,
    eventType: 'customer_session.issued',
    actor: { kind: 'CUSTOMER', guestId: input.guestId },
    payload: { guestId: input.guestId, method: input.method },
  });

  return {
    session: { id: row!.id, tenantId: input.tenantId, guestId: input.guestId, expiresAt },
    token: `${input.tenantId}.${token}`,
  };
}

function parse(value: string): { tenantId: string; tokenHash: string } | null {
  const at = value.indexOf('.');
  if (at <= 0) return null;
  const tenantId = value.slice(0, at);
  const token = value.slice(at + 1);
  if (!token) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) return null;
  return { tenantId, tokenHash: hashToken(token) };
}

/** Null for anything unusable — expired, revoked, or a guest that is gone. */
export async function resolveCustomerSession(
  value: string | undefined,
): Promise<CustomerSession | null> {
  if (!value) return null;
  const parsed = parse(value);
  if (!parsed) return null;

  return withTenant({ tenantId: parsed.tenantId }, async (tx) => {
    const rows = await tx.select({
      id: customerSessions.id,
      guestId: customerSessions.guestId,
      expiresAt: customerSessions.expiresAt,
    }).from(customerSessions)
      .where(and(
        eq(customerSessions.tokenHash, parsed.tokenHash),
        isNull(customerSessions.revokedAt),
        gt(customerSessions.expiresAt, new Date()),
      ))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    /**
     * `last_seen_at`, written on resolve rather than on a schedule.
     *
     * It is what makes "signed in on three devices" a real list rather than a
     * list of every device that ever signed in. One UPDATE on a row already
     * located by a unique index — cheaper than the SELECT above it.
     */
    await tx.update(customerSessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(customerSessions.id, row.id));

    return {
      id: row.id,
      tenantId: parsed.tenantId,
      guestId: row.guestId,
      expiresAt: row.expiresAt,
    };
  });
}

/** Signing out. One device. */
export async function revokeCustomerSession(tx: Tx, sessionId: string): Promise<void> {
  await tx.update(customerSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(customerSessions.id, sessionId), isNull(customerSessions.revokedAt)));
}

/**
 * Every device. Used when a phone number changes hands, and available to a
 * person who thinks somebody else has their account.
 */
export async function revokeAllCustomerSessions(tx: Tx, guestId: string): Promise<number> {
  const revoked = await tx.update(customerSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(customerSessions.guestId, guestId), isNull(customerSessions.revokedAt)))
    .returning({ id: customerSessions.id });
  return revoked.length;
}
