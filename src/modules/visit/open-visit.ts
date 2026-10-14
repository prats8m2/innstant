import { and, eq, isNull } from 'drizzle-orm';
import { recordEvent, type Tx } from '@/db';
import { visits, visitLinks } from '@/db/schema/visit';
import { upsertGuestByPhone } from '@/modules/stay';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { normalisePhone, isDialable } from '@/lib/phone';

/**
 * Opening a visit. D-079, and the exact counterpart of `createStay()`.
 *
 * CLAUDE.md #4 says every stay in the system is created by one function, and
 * EXTENSION-POINTS §A explains why: when a new origin arrives it becomes one
 * more caller rather than a sixth code path somebody has to find. A visit has
 * the same property and the same risk — today it is opened by a link, tomorrow
 * by a waiter's tablet and by a phone order taken at the counter — so it gets
 * the same discipline, enforced the same way by the lint rule in
 * eslint.config.mjs.
 *
 * Nothing else inserts into `visits`.
 */

export const VISIT_FULFILMENTS = ['DINE_IN', 'TAKEAWAY', 'DELIVERY'] as const;
export type VisitFulfilment = (typeof VISIT_FULFILMENTS)[number];

export type VisitLinkKind = 'TABLE' | 'COUNTER' | 'ONLINE';

/**
 * How long a visit — and therefore the session on it — stays usable.
 *
 * A stay's session expires at `scheduled_checkout_at` plus the property's
 * grace, which is a real moment in a real booking. A visit has no such moment,
 * so it gets a window instead, and the window is a product decision rather than
 * a technicality:
 *
 *   · Long enough to cover a meal and a second round, plus the walk home for a
 *     takeaway customer who wants to look at their order again.
 *   · Short enough that a table tent photographed by somebody at the next table
 *     stops being a live cart by the evening.
 *
 * Six hours. Re-opening the link mints a fresh visit, which costs one tap.
 */
export const VISIT_WINDOW_HOURS = 6;

export interface OpenVisitInput {
  tenantId: string;
  propertyId: string;
  outletId: string;
  /** Null when staff opened this at the counter rather than somebody scanning. */
  visitLinkId?: string | null;
  /** What the link is, carried onto the returned visit. See `Visit.linkKind`. */
  linkKind?: VisitLinkKind | null;
  fulfilment: VisitFulfilment;
  /** DINE_IN only. Copied from the link, never typed by the customer. */
  tableLabel?: string | null;
}

export interface Visit {
  id: string;
  tenantId: string;
  propertyId: string;
  outletId: string;
  visitLinkId: string | null;
  /**
   * What KIND of link opened this, when one did. D-080.
   *
   * Not derivable from the visit alone, which is why it is carried: COUNTER and
   * ONLINE both open as TAKEAWAY (`fulfilmentForLinkKind`), so after the fact
   * the fulfilment cannot tell them apart. Null for a visit staff opened at the
   * counter, or one whose link has since been deleted.
   *
   * Informational, deliberately. What decides whether a customer may be ASKED
   * about delivery is `tableLabel` — a table tent overrules a posted
   * fulfilment in `setVisitDetails()` regardless of what any client believes.
   */
  linkKind: VisitLinkKind | null;
  status: 'OPEN' | 'CLOSED';
  fulfilment: VisitFulfilment;
  customerName: string | null;
  customerPhone: string | null;
  tableLabel: string | null;
  deliveryAddress: string | null;
  deliveryNotes: string | null;
  expiresAt: Date;
}

/**
 * The fulfilment a link implies, before anybody has chosen anything.
 *
 * TABLE and COUNTER answer it outright. ONLINE cannot — it is the link in a
 * bio, and whether this is a pickup or a delivery is the one thing the customer
 * has to say. It opens as TAKEAWAY because that is the answer that needs
 * nothing further from them; choosing delivery at checkout moves it, and the
 * address becomes required at the same moment (`setVisitDetails`).
 */
export function fulfilmentForLinkKind(kind: VisitLinkKind): VisitFulfilment {
  switch (kind) {
    case 'TABLE': return 'DINE_IN';
    case 'COUNTER': return 'TAKEAWAY';
    case 'ONLINE': return 'TAKEAWAY';
  }
}

export async function openVisit(tx: Tx, input: OpenVisitInput): Promise<Visit> {
  if (input.fulfilment === 'DINE_IN' && !input.tableLabel?.trim()) {
    // A dine-in order with no table is a tray with nowhere to go. The link's
    // CHECK constraint says the same thing one level up; this says it here so
    // the failure is a sentence rather than a 23514.
    throw new ValidationError('A dine-in visit needs a table.');
  }

  const expiresAt = new Date(Date.now() + VISIT_WINDOW_HOURS * 60 * 60 * 1000);

  const [row] = await tx.insert(visits).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    outletId: input.outletId,
    visitLinkId: input.visitLinkId ?? null,
    /**
     * WRITTEN, not merely returned. D-081.
     *
     * This was on the returned object and absent from the INSERT, so every
     * visit created after 0009 would have taken NULL — and the account's
     * history filters `link_kind = 'ONLINE'`, which would then have matched
     * nothing, forever, rendering as "no orders yet" on a screen with no way
     * to tell that from a bug. The migration's backfill covered existing rows
     * and would have made it look briefly correct.
     */
    linkKind: input.linkKind ?? null,
    status: 'OPEN',
    fulfilment: input.fulfilment,
    tableLabel: input.fulfilment === 'DINE_IN' ? input.tableLabel!.trim() : null,
    expiresAt,
  }).returning({ id: visits.id });

  const visitId = row!.id;

  // #7 — the opening of a visit is a status change, and it is written here
  // rather than by the caller so that no origin can forget it.
  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'visit',
    entityId: visitId,
    eventType: 'visit.opened',
    toStatus: 'OPEN',
    actor: { kind: 'SYSTEM' },
    payload: {
      outletId: input.outletId,
      visitLinkId: input.visitLinkId ?? null,
      fulfilment: input.fulfilment,
    },
  });

  return {
    id: visitId,
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    outletId: input.outletId,
    visitLinkId: input.visitLinkId ?? null,
    linkKind: input.linkKind ?? null,
    status: 'OPEN',
    fulfilment: input.fulfilment,
    customerName: null,
    customerPhone: null,
    tableLabel: input.fulfilment === 'DINE_IN' ? input.tableLabel!.trim() : null,
    deliveryAddress: null,
    deliveryNotes: null,
    expiresAt,
  };
}

export async function findVisit(tx: Tx, visitId: string): Promise<Visit | null> {
  // A LEFT join, because `visit_link_id` is nullable twice over: a visit staff
  // opened has none, and the FK is ON DELETE SET NULL so a deleted link leaves
  // the visit standing. An inner join would make those visits vanish.
  const rows = await tx.select({
    visit: visits,
    linkKind: visitLinks.kind,
  }).from(visits)
    .leftJoin(visitLinks, eq(visitLinks.id, visits.visitLinkId))
    .where(eq(visits.id, visitId))
    .limit(1);

  const found = rows[0];
  if (!found) return null;
  const row = found.visit;
  return {
    id: row.id,
    tenantId: row.tenantId,
    propertyId: row.propertyId,
    outletId: row.outletId,
    visitLinkId: row.visitLinkId,
    // The visit's own copy first, the link's second. A visit opened before
    // 0009 has NULL and its link still answers; a visit whose link was deleted
    // has its own copy and no link. Either alone is wrong somewhere.
    linkKind: (row.linkKind as VisitLinkKind | null)
      ?? (found.linkKind as VisitLinkKind | null)
      ?? null,
    status: row.status,
    fulfilment: row.fulfilment as VisitFulfilment,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    tableLabel: row.tableLabel,
    deliveryAddress: row.deliveryAddress,
    deliveryNotes: row.deliveryNotes,
    expiresAt: row.expiresAt,
  };
}

export interface VisitDetailsInput {
  tenantId: string;
  propertyId: string;
  visitId: string;
  name: string;
  phone: string;
  fulfilment: VisitFulfilment;
  deliveryAddress?: string | null;
  deliveryNotes?: string | null;
  guestSessionId?: string;
}

/**
 * Who this is and where it goes — asked once, at checkout.
 *
 * ─── Why this is not an access tier ────────────────────────────────────────
 *
 * D-012's prompt defends one thing: posting money to somebody else's room. A
 * visit posts to no room, so there is nothing to defend and no tier to raise.
 * What is left is an operational need — a kitchen that cannot ring a customer
 * when the order is ready has to shout a number across a counter, and a
 * delivery with no address is a tray nobody can carry anywhere.
 *
 * So this is a form validation, enforced in the domain rather than the form,
 * for the same reason `placeOrder()` asserts its tier: a screen is an
 * affordance, and an affordance is not a control.
 *
 * ─── The phone is matched against `guests`, not stored twice ───────────────
 *
 * EXTENSION-POINTS §2 made `guests` tenant-scoped on (tenant_id, phone)
 * precisely so that a person is one row across a group. A regular at the
 * restaurant and somebody who stayed last March are the same person if the
 * number matches, and linking here is what stops a merge script existing
 * later. The visit keeps its own `customer_name` regardless — that is the
 * snapshot, and the name on the ticket must be the name they gave tonight.
 */
export async function setVisitDetails(tx: Tx, input: VisitDetailsInput): Promise<Visit> {
  const name = input.name.trim();
  // Normalised so the number stored here is the one a later sign-in resolves
  // to — see `upsertGuestByPhone`. The visit keeps what they TYPED nowhere;
  // what the kitchen rings is what this produces.
  const phone = normalisePhone(input.phone);

  if (name.length < 2) throw new ValidationError('We need a name for the order.');
  if (name.length > 80) throw new ValidationError('That name is too long for a ticket.');

  // Deliberately permissive: +91, spaces, hyphens and brackets all appear on a
  // number somebody reads off their own phone. What matters is that there are
  // enough digits to dial.
  if (!isDialable(phone)) {
    throw new ValidationError('That phone number does not look right. The kitchen calls when it is ready.');
  }

  const address = input.deliveryAddress?.trim() || null;
  if (input.fulfilment === 'DELIVERY' && !address) {
    throw new ValidationError('Delivery needs an address to go to.');
  }
  if (address && address.length > 400) {
    throw new ValidationError('That address is longer than a ticket can print. Shorten it.');
  }

  const current = await findVisit(tx, input.visitId);
  if (!current) {
    throw new NotFoundError('This order session has ended. Open the link again.', {
      detail: 'visit not found',
      visitId: input.visitId,
    });
  }
  if (current.status !== 'OPEN') {
    throw new ConflictError('This order session has closed. Open the link again.');
  }

  // A table tent is a table. Letting a form post DELIVERY against a DINE_IN
  // visit would move a tray off a table the kitchen can see to an address it
  // cannot check — so the link's own kind wins, always.
  const fulfilment = current.tableLabel ? 'DINE_IN' : input.fulfilment;

  /**
   * EXTENSION-POINTS §2 — `guests` is keyed (tenant_id, phone), so a regular at
   * the restaurant and somebody who stayed last March resolve to one row
   * without anybody merging anything later. Called through the stay module's
   * service interface rather than reached directly: `guests` is its table.
   */
  const guestId = await upsertGuestByPhone(tx, {
    tenantId: input.tenantId,
    phone,
    fullName: name,
  });

  await tx.update(visits).set({
    customerName: name,
    customerPhone: phone,
    fulfilment,
    deliveryAddress: fulfilment === 'DELIVERY' ? address : null,
    deliveryNotes: input.deliveryNotes?.trim() || null,
    guestId,
    updatedAt: new Date(),
  }).where(eq(visits.id, input.visitId));

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'visit',
    entityId: input.visitId,
    eventType: 'visit.identified',
    actor: input.guestSessionId
      ? { kind: 'GUEST', guestSessionId: input.guestSessionId }
      : { kind: 'SYSTEM' },
    // The number is NOT in the payload. `event_log` is the audit trail and it
    // is read by staff screens; a phone number belongs on the visit row, where
    // the kitchen reads it to make one call, and nowhere else.
    payload: { fulfilment, hasAddress: Boolean(address) },
  });

  const updated = await findVisit(tx, input.visitId);
  return updated!;
}

/** A visit ends when its last order is delivered, or when it lapses. Closing
 *  is what stops a stale cart reappearing behind a link somebody reopens. */
export async function closeVisit(
  tx: Tx,
  input: { tenantId: string; propertyId: string; visitId: string; reason: string },
): Promise<void> {
  const updated = await tx.update(visits)
    .set({ status: 'CLOSED', closedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(visits.id, input.visitId), eq(visits.status, 'OPEN')))
    .returning({ id: visits.id });

  if (!updated.length) return;

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'visit',
    entityId: input.visitId,
    eventType: 'visit.closed',
    fromStatus: 'OPEN',
    toStatus: 'CLOSED',
    actor: { kind: 'SYSTEM' },
    payload: { reason: input.reason },
  });
}

/** Does this link still open? Mirrors the live-code rule in `liveQrCodesForProperty`. */
export async function findLiveVisitLink(
  tx: Tx,
  input: { propertyId: string; visitLinkId: string },
): Promise<{ id: string; outletId: string; kind: VisitLinkKind; tableLabel: string | null } | null> {
  const rows = await tx.select({
    id: visitLinks.id,
    outletId: visitLinks.outletId,
    kind: visitLinks.kind,
    tableLabel: visitLinks.tableLabel,
  }).from(visitLinks)
    .where(and(
      eq(visitLinks.id, input.visitLinkId),
      eq(visitLinks.propertyId, input.propertyId),
      isNull(visitLinks.revokedAt),
    ))
    .limit(1);
  const row = rows[0];
  return row ? { ...row, kind: row.kind as VisitLinkKind } : null;
}

/**
 * How a visit reads on a kitchen ticket — the `destination_label` snapshot.
 *
 * Pure, and exported, for the same reason `toKitchenTicket` and the transition
 * tables are: it is the one piece of this that can be wrong in a way a type
 * cannot catch, and a cook reading the wrong line walks to the wrong place.
 */
export function destinationLabelFor(visit: {
  fulfilment: VisitFulfilment;
  tableLabel: string | null;
  customerName: string | null;
  deliveryAddress: string | null;
}): string {
  switch (visit.fulfilment) {
    case 'DINE_IN':
      return visit.tableLabel ?? 'Dine in';
    case 'TAKEAWAY':
      return visit.customerName ? `Takeaway · ${visit.customerName}` : 'Takeaway';
    case 'DELIVERY':
      return visit.deliveryAddress
        ? `Delivery · ${visit.deliveryAddress}`
        : 'Delivery';
  }
}
