import { and, eq, sql } from 'drizzle-orm';
import { recordEvent, type Tx } from '@/db';
import { serviceRequests, serviceRequestItems } from '@/db/schema/requests';
import { idempotencyKeys } from '@/db/schema/core';
import { postFolioLine } from '@/modules/billing';
import { findRoomAtProperty } from '@/modules/identity';
import { tierAtLeast, type AccessTier } from '@/modules/access';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';
import { formatMoney, money, type CurrencyCode } from '@/lib/money';
import { getRequestCatalog } from './catalog';

/**
 * Raising a service request. P2's counterpart to `placeOrder()`, and the same
 * four non-negotiables apply for the same reasons.
 *
 *   #6 every line snapshots its label and price. A property renaming "Extra
 *      towels" must not rewrite what a guest asked for last Tuesday, and the FK
 *      back to `request_types` is ON DELETE SET NULL for analytics only.
 *   #7 `event_log` gets `service_request.opened` in the same transaction.
 *   #8 idempotent. A guest tapping "Send" twice on hotel wifi is the most
 *      common duplicate in this product, and it is not hypothetical.
 *   #5 integer minor units, currency on the row.
 *
 * ─── Where it differs from an order, and why ────────────────────────────────
 *
 * **Most requests are free, and free must not cost a prompt (#9).** A guest
 * asking for towels at REQUEST tier gets towels. The tier check below is
 * conditional on the total being above zero — which is the whole of D-012 for
 * this path, and the reason `is_chargeable` exists on the type.
 *
 * **There is no cart.** A request is composed and sent in one screen: the
 * quantities live in the form, not in a table. That is not a shortcut — a cart
 * exists for orders because a guest browses a menu over several minutes, and
 * nobody browses towels.
 */

const IDEMPOTENCY_SCOPE = 'request.raise';
const IDEMPOTENCY_TTL_HOURS = 24;

export interface RequestLineInput {
  requestTypeId: string;
  quantity: number;
}

export interface RaiseRequestInput {
  tenantId: string;
  propertyId: string;
  stayId: string;
  roomId: string;
  /** What the guest asked for. One request, several lines. */
  lines: readonly RequestLineInput[];
  guestNote?: string | null;
  photoUrl?: string | null;
  /** #8 — minted when the screen rendered, so both taps carry one key. */
  idempotencyKey: string;
  /** The tier of the session doing this, checked against the total. */
  accessTier: AccessTier;
  guestSessionId?: string;
}

export interface RaisedRequest {
  requestId: string;
  requestNumber: string;
  totalMinor: number;
  currency: CurrencyCode;
  /** The promise the guest is given, and the SLA deadline. */
  slaTargetAt: Date;
  /** True when this call found an existing request for the same key (#8). */
  wasAlreadyRaised: boolean;
}

export async function raiseServiceRequest(
  tx: Tx,
  input: RaiseRequestInput,
): Promise<RaisedRequest> {
  if (!input.lines.length) throw new ValidationError('Choose something to ask for.');

  const replayed = await claimIdempotencyKey(tx, input);
  if (replayed) return { ...replayed, wasAlreadyRaised: true };

  const room = await findRoomAtProperty(tx, {
    propertyId: input.propertyId,
    roomId: input.roomId,
  });
  // `service_requests.floor_id` is NOT NULL because the routing rule is
  // role ∩ on-shift ∩ covers-floor (DATA-MODEL §7) — a request with no floor
  // cannot be routed to anyone.
  if (!room) throw new NotFoundError('That room is not at this property.');

  /**
   * The catalog, read fresh inside the transaction.
   *
   * Not trusted from the form: a request type switched off, archived, or
   * repriced between render and send must take effect. This is the same reason
   * the cart re-prices server-side rather than trusting what the screen showed.
   */
  const catalog = await getRequestCatalog(tx, { propertyId: input.propertyId });
  const byId = new Map(catalog.map((card) => [card.id, card]));

  const lines = input.lines.map((line) => {
    const type = byId.get(line.requestTypeId);
    if (!type) {
      throw new ConflictError('One of those is no longer offered. Take it off and send again.');
    }

    const quantity = Math.trunc(line.quantity);
    if (quantity < 1) throw new ValidationError('A quantity is at least one.');
    if (!type.allowsQuantity && quantity !== 1) {
      throw new ValidationError(`${type.name} is one at a time.`);
    }
    if (quantity > type.maxQuantity) {
      throw new ValidationError(
        `${type.name}: ${type.maxQuantity} is the most we can bring at once.`,
      );
    }

    return { type, quantity, lineTotalMinor: type.priceMinor * quantity };
  });

  const currency = lines[0]!.type.currency;
  const totalMinor = lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);

  /**
   * #9 and D-012, on this path.
   *
   * A free request needs nothing but a scanned QR — that is the whole promise of
   * the product's front door. A chargeable one is a charge to the room, and it
   * needs the same tier a dinner does. The screen escalates first; this refuses
   * regardless of what the screen did.
   */
  if (totalMinor > 0 && !tierAtLeast(input.accessTier, 'CHARGE')) {
    throw new ForbiddenError(
      `${formatMoney(money(totalMinor, currency))} goes on your room, so we need to check who you are first.`,
    );
  }

  const note = input.guestNote?.trim() || null;
  if (note && !lines.some((line) => line.type.allowsNote)) {
    throw new ValidationError('There is nowhere to put a note on this request.');
  }
  const photoUrl = input.photoUrl?.trim() || null;
  if (photoUrl && !lines.some((line) => line.type.allowsPhoto)) {
    // A photo of a leak saves a trip; a photo attached to a towel request is
    // someone poking at the API.
    throw new ValidationError('This request does not take a photo.');
  }

  /**
   * The deadline is the SLOWEST thing asked for.
   *
   * Towels in 12 minutes and a wake-up call in 5 arriving in one request cannot
   * both be the promise; taking the longest means the request is not marked
   * breached while part of it is legitimately still coming. The guest is shown
   * the same number, so the promise and the deadline stay one number
   * (DATA-MODEL §7).
   */
  const slaMinutes = Math.max(...lines.map((line) => line.type.slaMinutes));
  const now = new Date();
  const slaTargetAt = new Date(now.getTime() + slaMinutes * 60_000);

  const requestNumber = await nextRequestNumber(tx, input.propertyId);

  const [request] = await tx.insert(serviceRequests).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    stayId: input.stayId,
    floorId: room.floorId,
    // The type of the FIRST line, for the single-type analytics case. The
    // per-line FKs below are what a multi-line request is actually read from.
    requestTypeId: lines[0]!.type.id,
    requestNumber,
    status: 'OPEN',
    guestNote: note,
    photoUrl,
    totalMinor,
    currency,
    slaTargetAt,
  }).returning({ id: serviceRequests.id });

  const requestId = request!.id;

  // #6 — the label and the price AS ASKED. Renaming the type later cannot
  // rewrite this, and the FK is analytics only.
  await tx.insert(serviceRequestItems).values(lines.map((line) => ({
    tenantId: input.tenantId,
    serviceRequestId: requestId,
    requestTypeId: line.type.id,
    labelSnapshot: line.type.name,
    unitPriceMinor: line.type.priceMinor,
    currency,
    quantity: line.quantity,
    lineTotalMinor: line.lineTotalMinor,
  })));

  // The folio line, in the same transaction, so "on your room" is true the
  // instant the guest is told it.
  if (totalMinor > 0) {
    await postFolioLine(tx, {
      tenantId: input.tenantId,
      propertyId: input.propertyId,
      stayId: input.stayId,
      source: 'SERVICE_REQUEST',
      sourceRefId: requestId,
      description: `${lines.map((l) => l.type.name).join(', ')} · ${requestNumber}`,
      amountMinor: totalMinor,
      currency,
    });
  }

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'service_request',
    entityId: requestId,
    eventType: 'service_request.opened',
    toStatus: 'OPEN',
    actor: input.guestSessionId
      ? { kind: 'GUEST', guestSessionId: input.guestSessionId }
      : { kind: 'SYSTEM' },
    payload: {
      requestNumber,
      roomNumber: room.number,
      lines: lines.map((l) => `${l.quantity}× ${l.type.name}`),
      totalMinor,
      currency,
      slaMinutes,
    },
  });

  await notifyRequestChanged(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    requestId,
    requestNumber,
    floorId: room.floorId,
    stayId: input.stayId,
    status: 'OPEN',
  });

  const result = {
    requestId,
    requestNumber,
    totalMinor,
    currency,
    slaTargetAt,
  };

  await tx.update(idempotencyKeys)
    .set({ status: 'COMPLETED', responseBody: result, responseStatus: 201 })
    .where(and(
      eq(idempotencyKeys.tenantId, input.tenantId),
      eq(idempotencyKeys.scope, IDEMPOTENCY_SCOPE),
      eq(idempotencyKeys.key, input.idempotencyKey),
    ));

  return { ...result, wasAlreadyRaised: false };
}

/**
 * Tell every listening process a request moved. Same mechanism as orders:
 * `pg_notify` INSIDE the transaction, so a board can never be told about
 * something that then rolls back.
 *
 * The payload carries routing only — the floor is what a staff board filters
 * on, and the receiving screen re-reads what it is allowed to see through RLS.
 */
export const REQUEST_CHANNEL = 'service_request_changed';

export interface RequestChangedPayload {
  tenantId: string;
  propertyId: string;
  requestId: string;
  requestNumber: string;
  floorId: string;
  stayId: string;
  status: string;
}

export async function notifyRequestChanged(
  tx: Tx,
  payload: RequestChangedPayload,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_notify(${REQUEST_CHANNEL}, ${JSON.stringify(payload)})`,
  );
}

/** #8. Claims the key, or returns what the previous attempt produced. */
async function claimIdempotencyKey(
  tx: Tx,
  input: RaiseRequestInput,
): Promise<Omit<RaisedRequest, 'wasAlreadyRaised'> | null> {
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000);

  await tx.insert(idempotencyKeys).values({
    tenantId: input.tenantId,
    scope: IDEMPOTENCY_SCOPE,
    key: input.idempotencyKey,
    status: 'IN_PROGRESS',
    expiresAt,
  }).onConflictDoNothing();

  const rows = await tx.select({
    status: idempotencyKeys.status,
    responseBody: idempotencyKeys.responseBody,
    createdAt: idempotencyKeys.createdAt,
  }).from(idempotencyKeys)
    .where(and(
      eq(idempotencyKeys.tenantId, input.tenantId),
      eq(idempotencyKeys.scope, IDEMPOTENCY_SCOPE),
      eq(idempotencyKeys.key, input.idempotencyKey),
    ))
    .limit(1);

  const claim = rows[0];
  if (!claim) throw new ConflictError('That could not be sent. Try again.');

  if (claim.status === 'COMPLETED') {
    const body = claim.responseBody as Omit<RaisedRequest, 'wasAlreadyRaised' | 'slaTargetAt'>
      & { slaTargetAt: string };
    // JSON round-trip: the stored body has an ISO string where the caller
    // expects a Date, and a screen formatting `"2026-09-01T…"` as a time shows
    // "Invalid Date".
    return { ...body, slaTargetAt: new Date(body.slaTargetAt) };
  }

  const isOurs = Date.now() - new Date(claim.createdAt).getTime() < 1_000;
  if (isOurs) return null;

  throw new ConflictError('That request is already with the team.');
}

/**
 * `SR-1042`. Unique per property, and the number a guest quotes at the desk.
 *
 * Same advisory lock as order numbers, keyed on the property so allocation for
 * one hotel never blocks another. A different lock key from orders would let a
 * request and an order interleave, which is fine — they are separate sequences.
 */
async function nextRequestNumber(tx: Tx, propertyId: string): Promise<string> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'request:' + propertyId}))`);

  const rows = await tx.execute<{ next: number }>(sql`
    SELECT COALESCE(MAX(NULLIF(regexp_replace(request_number, '\\D', '', 'g'), '')::int), 1041) + 1 AS next
    FROM service_requests
    WHERE property_id = ${propertyId}
  `);

  return `SR-${Number(rows.rows[0]?.next ?? 1042)}`;
}
