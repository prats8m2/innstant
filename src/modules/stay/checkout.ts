import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { recordEvent, type Tx } from '@/db';
import { stays, checkoutRequests, checkoutFeeTiers } from '@/db/schema/stay';
import { postFolioLine } from '@/modules/billing';
import { refreshSessionExpiryForStay } from '@/modules/access';
import { notifyPms } from './pms/sync';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import type { CurrencyCode } from '@/lib/money';
import { formatHour, localTimeAt } from '@/lib/clock';
import {
  checkoutOffersFor, canDecideCheckout, effectiveFeeMinor,
  type CheckoutOffer, type CheckoutRequestStatus,
} from './checkout-rules';

/**
 * Changing when a guest leaves.
 *
 * Three shapes, one table. A late checkout buys hours and costs a fee; leaving
 * early costs nothing; both are `checkout_requests` rows the front desk decides,
 * because a room the housekeeping rota has already been built around is not the
 * guest's to reassign on their own.
 *
 * ─── Why the fee posts on APPROVAL, not on request ─────────────────────────
 *
 * Every other charge path in the product posts at placement — `placeOrder()` and
 * `raiseServiceRequest()` both do, so "charged to room 214" is true the moment
 * the guest is told it, and both then have to credit it back if the thing does
 * not happen (D-027, D-032).
 *
 * This one is the other way round on purpose. A guest who asks for 2pm has
 * received nothing until somebody says yes, and a declined request that charged
 * and refunded would put the hotel's "no" on the guest's bill twice. So the fee
 * is SNAPSHOT at request — the amount the guest agreed to, which the desk may
 * override but not silently inflate — and POSTED at approval, once.
 *
 * Which is also why this path needs no reversal to pair with: nothing is charged
 * for a request that is declined, cancelled or still waiting. The one reversal
 * here is for the case that does happen — an approval undone by the desk.
 */

export interface CheckoutOptions {
  scheduledCheckoutAt: Date;
  offers: CheckoutOffer[];
  /** The one open request, if the guest already asked for something. */
  pending: PendingCheckoutRequest | null;
  currency: CurrencyCode;
}

export interface PendingCheckoutRequest {
  id: string;
  status: CheckoutRequestStatus;
  requestedCheckoutAt: Date;
  feeMinor: number;
  overriddenFeeMinor: number | null;
  currency: CurrencyCode;
  declineReason: string | null;
  decidedAt: Date | null;
}

/**
 * What this guest may ask for, and what they have already asked for.
 *
 * The tiers are the property's; which of them are OFFERABLE depends on this
 * stay's own checkout time and on the clock, and that decision is pure
 * (`checkoutOffersFor`).
 */
export async function getCheckoutOptions(
  tx: Tx,
  input: { propertyId: string; stayId: string; timeZone: string; now?: Date },
): Promise<CheckoutOptions> {
  const stayRows = await tx.select({
    scheduledCheckoutAt: stays.scheduledCheckoutAt,
    status: stays.status,
  }).from(stays)
    .where(and(eq(stays.id, input.stayId), eq(stays.propertyId, input.propertyId)))
    .limit(1);

  const stay = stayRows[0];
  if (!stay) throw new NotFoundError('No such stay at this property.');

  const tiers = await tx.select({
    id: checkoutFeeTiers.id,
    hour: checkoutFeeTiers.hour,
    note: checkoutFeeTiers.note,
    feeMinor: checkoutFeeTiers.feeMinor,
    currency: checkoutFeeTiers.currency,
  }).from(checkoutFeeTiers)
    .where(and(
      eq(checkoutFeeTiers.propertyId, input.propertyId),
      eq(checkoutFeeTiers.isActive, true),
      isNull(checkoutFeeTiers.archivedAt),
    ));

  const latest = await latestRequestFor(tx, input);

  return {
    scheduledCheckoutAt: stay.scheduledCheckoutAt,
    offers: checkoutOffersFor({
      tiers,
      scheduledCheckoutAt: stay.scheduledCheckoutAt,
      now: input.now ?? new Date(),
      timeZone: input.timeZone,
    }),
    pending: latest,
    currency: (tiers[0]?.currency ?? 'INR') as CurrencyCode,
  };
}

/**
 * The most recent request, whatever state it is in.
 *
 * Not just the open one: a guest whose 2pm was declined an hour ago needs to
 * read that on the screen rather than find the options quietly back as if they
 * had never asked.
 */
async function latestRequestFor(
  tx: Tx,
  input: { propertyId: string; stayId: string },
): Promise<PendingCheckoutRequest | null> {
  const rows = await tx.select({
    id: checkoutRequests.id,
    status: checkoutRequests.status,
    requestedCheckoutAt: checkoutRequests.requestedCheckoutAt,
    feeMinor: checkoutRequests.feeMinor,
    overriddenFeeMinor: checkoutRequests.overriddenFeeMinor,
    currency: checkoutRequests.currency,
    declineReason: checkoutRequests.declineReason,
    decidedAt: checkoutRequests.decidedAt,
  }).from(checkoutRequests)
    .where(and(
      eq(checkoutRequests.stayId, input.stayId),
      eq(checkoutRequests.propertyId, input.propertyId),
    ))
    .orderBy(desc(checkoutRequests.createdAt))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    status: row.status as CheckoutRequestStatus,
    currency: row.currency as CurrencyCode,
  };
}

export interface RequestCheckoutInput {
  tenantId: string;
  propertyId: string;
  stayId: string;
  /** The instant the guest wants to leave, property-local hour already resolved. */
  requestedCheckoutAt: Date;
  /** Snapshot of what they agreed to. Zero for leaving early. */
  feeMinor: number;
  currency: string;
  guestSessionId?: string | null;
}

export interface RequestedCheckout {
  id: string;
  feeMinor: number;
  /** True when an identical open request already existed — a double tap (#8). */
  wasAlreadyRequested: boolean;
}

/**
 * The guest asks.
 *
 * Idempotent through the database rather than through a key: a partial unique
 * index allows one REQUESTED row per stay (migration 0005), so a double tap on
 * hotel wifi is a conflict the insert absorbs rather than a second thing for the
 * desk to decide. The existing row is returned, which is also the right answer
 * for a guest who asked on their phone and again on the tablet.
 */
export async function requestCheckoutChange(
  tx: Tx,
  input: RequestCheckoutInput,
): Promise<RequestedCheckout> {
  if (!Number.isInteger(input.feeMinor) || input.feeMinor < 0) {
    throw new ValidationError('A checkout fee cannot be negative.');
  }

  const stayRows = await tx.select({
    status: stays.status,
    scheduledCheckoutAt: stays.scheduledCheckoutAt,
  }).from(stays)
    .where(and(eq(stays.id, input.stayId), eq(stays.propertyId, input.propertyId)))
    .limit(1);

  const stay = stayRows[0];
  if (!stay) throw new NotFoundError('No such stay at this property.');
  if (stay.status !== 'CHECKED_IN') {
    throw new ConflictError('This stay is not currently checked in.');
  }

  const inserted = await tx.insert(checkoutRequests).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    stayId: input.stayId,
    status: 'REQUESTED',
    requestedCheckoutAt: input.requestedCheckoutAt,
    feeMinor: input.feeMinor,
    currency: input.currency,
  }).onConflictDoNothing().returning({ id: checkoutRequests.id });

  if (!inserted[0]) {
    const open = await tx.select({
      id: checkoutRequests.id,
      feeMinor: checkoutRequests.feeMinor,
    }).from(checkoutRequests)
      .where(and(
        eq(checkoutRequests.stayId, input.stayId),
        eq(checkoutRequests.status, 'REQUESTED'),
      ))
      .limit(1);

    const existing = open[0];
    // Only reachable if the row was decided between the insert and this read,
    // which is a race the guest should simply retry into.
    if (!existing) throw new ConflictError('That request was just decided. Look again.');
    return { id: existing.id, feeMinor: existing.feeMinor, wasAlreadyRequested: true };
  }

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'checkout_request',
    entityId: inserted[0].id,
    eventType: 'checkout_request.requested',
    toStatus: 'REQUESTED',
    actor: input.guestSessionId
      ? { kind: 'GUEST', guestSessionId: input.guestSessionId }
      : { kind: 'SYSTEM' },
    payload: {
      requestedCheckoutAt: input.requestedCheckoutAt.toISOString(),
      feeMinor: input.feeMinor,
      currency: input.currency,
    },
  });

  return { id: inserted[0].id, feeMinor: input.feeMinor, wasAlreadyRequested: false };
}

/** The guest changes their mind before the desk has looked. */
export async function cancelCheckoutRequest(
  tx: Tx,
  input: {
    tenantId: string; propertyId: string; stayId: string;
    checkoutRequestId: string; guestSessionId?: string | null;
  },
): Promise<void> {
  const updated = await tx.update(checkoutRequests)
    .set({ status: 'CANCELLED', updatedAt: new Date() })
    .where(and(
      eq(checkoutRequests.id, input.checkoutRequestId),
      eq(checkoutRequests.stayId, input.stayId),
      // Compare-and-set: a desk approving in the same second wins, and the
      // guest is told rather than silently overriding a decision.
      eq(checkoutRequests.status, 'REQUESTED'),
    ))
    .returning({ id: checkoutRequests.id });

  if (!updated[0]) {
    throw new ConflictError('That request has already been decided. Look at it again.');
  }

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'checkout_request',
    entityId: input.checkoutRequestId,
    eventType: 'checkout_request.cancelled',
    fromStatus: 'REQUESTED',
    toStatus: 'CANCELLED',
    actor: input.guestSessionId
      ? { kind: 'GUEST', guestSessionId: input.guestSessionId }
      : { kind: 'SYSTEM' },
    payload: {},
  });
}

export interface DecideCheckoutInput {
  tenantId: string;
  propertyId: string;
  checkoutRequestId: string;
  to: 'APPROVED' | 'DECLINED';
  /** Only on APPROVED, and only when the desk is changing what was agreed. */
  overriddenFeeMinor?: number | null;
  /** Required on DECLINED — the guest reads it. */
  declineReason?: string | null;
  staffUserId: string;
  /** The property's, for the hour on the folio line the guest reads. */
  timeZone: string;
}

export interface DecidedCheckout {
  status: 'APPROVED' | 'DECLINED';
  stayId: string;
  scheduledCheckoutAt: Date;
  feeMinor: number;
  sessionsExtended: number;
}

/**
 * The desk decides. Everything that follows an approval happens here, in one
 * transaction: the stay moves, the fee posts, the sessions follow, the log
 * records it (#7).
 *
 * Splitting any of those out would leave a stay whose checkout moved and whose
 * fee did not, or a guest paying for a room their phone stopped working in —
 * both of which are discovered by the guest rather than by us.
 */
export async function decideCheckoutRequest(
  tx: Tx,
  input: DecideCheckoutInput,
): Promise<DecidedCheckout> {
  const rows = await tx.select({
    id: checkoutRequests.id,
    stayId: checkoutRequests.stayId,
    status: checkoutRequests.status,
    requestedCheckoutAt: checkoutRequests.requestedCheckoutAt,
    feeMinor: checkoutRequests.feeMinor,
    currency: checkoutRequests.currency,
  }).from(checkoutRequests)
    .where(and(
      eq(checkoutRequests.id, input.checkoutRequestId),
      eq(checkoutRequests.propertyId, input.propertyId),
    ))
    .limit(1);

  const request = rows[0];
  if (!request) throw new NotFoundError('No such checkout request at this property.');

  const from = request.status as CheckoutRequestStatus;
  if (!canDecideCheckout(from, input.to)) {
    throw new ConflictError(
      from === input.to
        ? `This request is already ${from.toLowerCase()}.`
        : `A ${from.toLowerCase()} request cannot be ${input.to.toLowerCase()}.`,
    );
  }

  if (input.to === 'DECLINED' && !input.declineReason?.trim()) {
    throw new ValidationError('Say why — the guest reads it.');
  }

  if (input.overriddenFeeMinor != null
      && (!Number.isInteger(input.overriddenFeeMinor) || input.overriddenFeeMinor < 0)) {
    throw new ValidationError('An overridden fee cannot be negative.');
  }

  const now = new Date();
  const fee = input.to === 'APPROVED'
    ? effectiveFeeMinor({
      feeMinor: request.feeMinor,
      overriddenFeeMinor: input.overriddenFeeMinor ?? null,
    })
    : 0;

  const updated = await tx.update(checkoutRequests)
    .set({
      status: input.to,
      // Both values kept — what the guest agreed to and what the desk charged.
      // "Why is this ₹1,000 when the app said ₹2,500" has to be answerable.
      overriddenFeeMinor: input.to === 'APPROVED' ? input.overriddenFeeMinor ?? null : null,
      declineReason: input.to === 'DECLINED' ? input.declineReason!.trim() : null,
      decidedByStaffId: input.staffUserId,
      decidedAt: now,
      updatedAt: now,
    })
    .where(and(
      eq(checkoutRequests.id, request.id),
      // Two people at the desk, same request, same second.
      eq(checkoutRequests.status, from),
    ))
    .returning({ id: checkoutRequests.id });

  if (!updated[0]) {
    throw new ConflictError('Somebody just decided this one. Look at it again.');
  }

  let sessionsExtended = 0;
  let scheduledCheckoutAt = request.requestedCheckoutAt;

  /**
   * What the stay is called on the other side of the seam. Our uuids mean
   * nothing to a PMS (EXTENSION-POINTS §3), and this is read once for both
   * events below rather than per event.
   */
  const refRows = input.to === 'APPROVED'
    ? await tx.execute<{ source_ref_id: string | null; room_number: string }>(sql`
        SELECT s.source_ref_id, rm.number AS room_number
        FROM stays s JOIN rooms rm ON rm.id = s.room_id
        WHERE s.id = ${request.stayId} LIMIT 1
      `)
    : null;
  const stayRef = refRows?.rows[0]
    ? { sourceRefId: refRows.rows[0].source_ref_id, roomNumber: refRows.rows[0].room_number }
    : null;

  if (input.to === 'APPROVED') {
    await tx.update(stays)
      .set({ scheduledCheckoutAt: request.requestedCheckoutAt, updatedAt: now })
      .where(eq(stays.id, request.stayId));

    /**
     * The sessions follow the stay. A session expires at
     * `scheduled_checkout_at + grace`, fixed when it was minted — so without
     * this the guest pays for the room until 6pm and the app in it stops
     * working at 1pm.
     */
    sessionsExtended = await refreshSessionExpiryForStay(tx, {
      propertyId: input.propertyId,
      stayId: request.stayId,
      scheduledCheckoutAt: request.requestedCheckoutAt,
    });

    /**
     * The system of record hears about both halves — the stay moving, and the
     * money — because a PMS that knows about one and not the other produces a
     * bill that does not reconcile (D-011).
     */
    await notifyPms(tx, {
      tenantId: input.tenantId,
      propertyId: input.propertyId,
      event: {
        kind: 'STAY_EXTENDED',
        stay: {
          stayId: request.stayId,
          sourceRefId: stayRef?.sourceRefId ?? null,
          roomNumber: stayRef?.roomNumber ?? '',
        },
        scheduledCheckoutAt: request.requestedCheckoutAt.toISOString(),
        reason: 'LATE_CHECKOUT',
      },
    });

    if (fee > 0) {
      const posted = await postFolioLine(tx, {
        tenantId: input.tenantId,
        propertyId: input.propertyId,
        stayId: request.stayId,
        source: 'CHECKOUT_FEE',
        sourceRefId: request.id,
        // The hotel's 2pm, not the server's — the guest reads this line.
        description: `Late checkout · ${formatHour(
          Math.floor(localTimeAt(request.requestedCheckoutAt, input.timeZone).minutes / 60),
        )}`,
        amountMinor: fee,
        currency: request.currency,
        postedByStaffId: input.staffUserId,
      });

      await notifyPms(tx, {
        tenantId: input.tenantId,
        propertyId: input.propertyId,
        event: {
          kind: 'CHARGE_POSTED',
          stay: {
            stayId: request.stayId,
            sourceRefId: stayRef?.sourceRefId ?? null,
            roomNumber: stayRef?.roomNumber ?? '',
          },
          description: 'Late checkout',
          amountMinor: fee,
          currency: request.currency,
          folioLineId: posted.folioLineId,
        },
      });
    }
  } else {
    const stayRows = await tx.select({ scheduledCheckoutAt: stays.scheduledCheckoutAt })
      .from(stays).where(eq(stays.id, request.stayId)).limit(1);
    scheduledCheckoutAt = stayRows[0]?.scheduledCheckoutAt ?? request.requestedCheckoutAt;
  }

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'checkout_request',
    entityId: request.id,
    eventType: `checkout_request.${input.to.toLowerCase()}`,
    fromStatus: from,
    toStatus: input.to,
    actor: { kind: 'STAFF', staffUserId: input.staffUserId },
    payload: {
      agreedFeeMinor: request.feeMinor,
      chargedFeeMinor: fee,
      ...(input.overriddenFeeMinor != null ? { overridden: true } : {}),
      ...(input.declineReason ? { reason: input.declineReason.trim() } : {}),
      requestedCheckoutAt: request.requestedCheckoutAt.toISOString(),
      sessionsExtended,
    },
  });

  return {
    status: input.to,
    stayId: request.stayId,
    scheduledCheckoutAt,
    feeMinor: fee,
    sessionsExtended,
  };
}

/** Everything waiting on the desk, oldest first — a queue, not a feed. */
export interface DeskCheckoutRequest extends PendingCheckoutRequest {
  stayId: string;
  roomNumber: string;
  guestName: string;
  scheduledCheckoutAt: Date;
  createdAt: Date;
}

export async function listCheckoutRequests(
  tx: Tx,
  input: { propertyId: string; statuses?: readonly CheckoutRequestStatus[] },
): Promise<DeskCheckoutRequest[]> {
  const wanted = input.statuses ?? (['REQUESTED'] as const);

  /**
   * Raw SQL across `rooms` and `guests` (D-001): a read-only projection inside
   * the tenant-scoped transaction, the same narrow exception the kitchen ticket
   * and the floor board already take. RLS still applies to every row.
   */
  const rows = await tx.execute<{
    id: string; stay_id: string; status: string; requested_checkout_at: Date;
    fee_minor: number; overridden_fee_minor: number | null; currency: string;
    decline_reason: string | null; decided_at: Date | null;
    room_number: string; guest_name: string; scheduled_checkout_at: Date; created_at: Date;
  }>(sql`
    SELECT cr.id, cr.stay_id, cr.status, cr.requested_checkout_at,
           cr.fee_minor, cr.overridden_fee_minor, cr.currency,
           cr.decline_reason, cr.decided_at, cr.created_at,
           rm.number AS room_number, g.full_name AS guest_name,
           s.scheduled_checkout_at
    FROM checkout_requests cr
    JOIN stays s ON s.id = cr.stay_id
    JOIN rooms rm ON rm.id = s.room_id
    JOIN guests g ON g.id = s.guest_id
    WHERE cr.property_id = ${input.propertyId}
      -- One placeholder per value, not a hand-built array literal. The values
      -- come from a typed union today, and building SQL by concatenation is a
      -- habit that outlives the types that made it safe. Passing the array
      -- itself does not work: drizzle flattens it into comma-separated params
      -- and Postgres reads "REQUESTED" as a malformed array literal.
      AND cr.status::text IN (${sql.join(wanted.map((status) => sql`${status}`), sql`, `)})
    ORDER BY cr.created_at ASC
  `);

  return rows.rows.map((row) => ({
    id: row.id,
    stayId: row.stay_id,
    status: row.status as CheckoutRequestStatus,
    requestedCheckoutAt: new Date(row.requested_checkout_at),
    feeMinor: Number(row.fee_minor),
    overriddenFeeMinor: row.overridden_fee_minor === null ? null : Number(row.overridden_fee_minor),
    currency: row.currency as CurrencyCode,
    declineReason: row.decline_reason,
    decidedAt: row.decided_at ? new Date(row.decided_at) : null,
    roomNumber: row.room_number,
    guestName: row.guest_name,
    scheduledCheckoutAt: new Date(row.scheduled_checkout_at),
    createdAt: new Date(row.created_at),
  }));
}
