import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { recordEvent, type Tx } from '@/db';
import { visitLinks, visits } from '@/db/schema/visit';
import { newPublicCode } from '@/modules/identity';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import type { VisitLinkKind } from './open-visit';

/**
 * Property links — the admin half. D-079.
 *
 * The counterpart to `issueQrCode()` in `modules/identity/property-setup.ts`,
 * and deliberately the same shape: a code is minted by one generator, a reprint
 * mints a new version and revokes the old one, and `version` counts stickers
 * printed rather than stickers live so the audit trail and the plastic agree.
 *
 * `newPublicCode()` is imported rather than reimplemented. Two generators would
 * be two answers to "how guessable is a code", and the one in identity is
 * already the answer this product gives — 9 random bytes, base64url.
 */

export interface VisitLinkRow {
  id: string;
  outletId: string;
  publicCode: string;
  kind: VisitLinkKind;
  label: string;
  tableLabel: string | null;
  version: number;
  revokedAt: Date | null;
  createdAt: Date;
  /** How many visits this link has actually opened. The question a GM asks
   *  first: which tent gets used, and which one is decoration. */
  visitCount: number;
}

export interface CreateVisitLinkInput {
  tenantId: string;
  propertyId: string;
  outletId: string;
  kind: VisitLinkKind;
  label: string;
  /** Required for TABLE, forbidden otherwise — the database says so too. */
  tableLabel?: string | null;
  staffUserId?: string;

  /**
   * Override the public code. **The demo property and nothing else.**
   *
   * A real link's code must be random: it is a capability printed on a tent or
   * posted in a bio, and a guessable scheme lets somebody walk a chain's
   * tables. `newPublicCode()` is the only correct answer there, and it is the
   * default precisely so that forgetting this option is safe.
   *
   * The demo property is the opposite problem, and the room sticker's version
   * of this note (`publicCodeFor` in modules/identity/provision.ts) explains it
   * at length: `pnpm demo:reset` rebuilds the property, which would reissue
   * every code and break every link anyone has written down. Its data is
   * invented and reachable from a public button, so a stable readable code is
   * strictly better.
   *
   * Only `scripts/demo-reset.ts` passes this. If you find yourself reaching for
   * it anywhere else, the answer is no.
   */
  publicCode?: string;
}

const MAX_LABEL = 60;

export async function createVisitLink(
  tx: Tx,
  input: CreateVisitLinkInput,
): Promise<{ id: string; publicCode: string }> {
  const label = input.label.trim();
  if (!label) throw new ValidationError('Give the link a name so staff can find it.');
  if (label.length > MAX_LABEL) {
    throw new ValidationError(`That name is longer than ${MAX_LABEL} characters.`);
  }

  const tableLabel = input.tableLabel?.trim() || null;
  if (input.kind === 'TABLE' && !tableLabel) {
    throw new ValidationError('A table link needs the table it belongs to.');
  }
  if (input.kind !== 'TABLE' && tableLabel) {
    // Not pedantry: the kitchen ticket reads `table_label` when it is set, so a
    // stray one would print "Table 4" on a delivery.
    throw new ValidationError('Only a table link carries a table.');
  }

  const publicCode = input.publicCode ?? newPublicCode();

  const [row] = await tx.insert(visitLinks).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    outletId: input.outletId,
    publicCode,
    kind: input.kind,
    label,
    tableLabel,
    version: 1,
  }).returning({ id: visitLinks.id });

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'visit_link',
    entityId: row!.id,
    eventType: 'visit_link.created',
    actor: input.staffUserId ? { kind: 'STAFF', staffUserId: input.staffUserId } : { kind: 'SYSTEM' },
    // The CODE is not in the payload. It is a capability — printing it into the
    // audit trail would make every staff member who can read the log able to
    // order from every table, which is the one thing revoking a link is for.
    payload: { kind: input.kind, label, outletId: input.outletId },
  });

  return { id: row!.id, publicCode };
}

/**
 * Reprint. Revokes every live code on this link and mints the next version.
 *
 * The old URL stops working the instant this commits, which is the point: it is
 * what a restaurant does when a tent is photographed, or when a menu board goes
 * in the bin with the code still on it.
 */
export async function regenerateVisitLink(
  tx: Tx,
  input: { tenantId: string; propertyId: string; visitLinkId: string; staffUserId?: string },
): Promise<{ publicCode: string; version: number }> {
  const rows = await tx.select().from(visitLinks)
    .where(and(
      eq(visitLinks.id, input.visitLinkId),
      eq(visitLinks.propertyId, input.propertyId),
    ))
    .limit(1);

  const link = rows[0];
  if (!link) throw new NotFoundError('That link does not exist here.');
  if (link.revokedAt) throw new ConflictError('That link has been revoked. Create a new one.');

  const publicCode = newPublicCode();
  const version = link.version + 1;

  await tx.update(visitLinks)
    .set({ publicCode, version, updatedAt: new Date() })
    .where(eq(visitLinks.id, input.visitLinkId));

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'visit_link',
    entityId: input.visitLinkId,
    eventType: 'visit_link.regenerated',
    actor: input.staffUserId ? { kind: 'STAFF', staffUserId: input.staffUserId } : { kind: 'SYSTEM' },
    payload: { fromVersion: link.version, toVersion: version },
  });

  return { publicCode, version };
}

/** Revoking is permanent and the link stops opening. Visits already open
 *  against it are untouched — somebody mid-meal keeps their order. */
export async function revokeVisitLink(
  tx: Tx,
  input: { tenantId: string; propertyId: string; visitLinkId: string; staffUserId?: string },
): Promise<void> {
  const updated = await tx.update(visitLinks)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(visitLinks.id, input.visitLinkId),
      eq(visitLinks.propertyId, input.propertyId),
      isNull(visitLinks.revokedAt),
    ))
    .returning({ id: visitLinks.id });

  if (!updated.length) return;

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'visit_link',
    entityId: input.visitLinkId,
    eventType: 'visit_link.revoked',
    actor: input.staffUserId ? { kind: 'STAFF', staffUserId: input.staffUserId } : { kind: 'SYSTEM' },
    payload: {},
  });
}

/**
 * Every link at a property, live ones first.
 *
 * The visit count is a correlated subquery rather than a join with a GROUP BY:
 * a property has a handful of links, and the grouped form made the revoked ones
 * with no visits disappear from the list, which is exactly the row somebody is
 * looking for when they come here.
 */
export async function listVisitLinks(
  tx: Tx,
  input: { propertyId: string },
): Promise<VisitLinkRow[]> {
  const rows = await tx.select({
    id: visitLinks.id,
    outletId: visitLinks.outletId,
    publicCode: visitLinks.publicCode,
    kind: visitLinks.kind,
    label: visitLinks.label,
    tableLabel: visitLinks.tableLabel,
    version: visitLinks.version,
    revokedAt: visitLinks.revokedAt,
    createdAt: visitLinks.createdAt,
  }).from(visitLinks)
    .where(eq(visitLinks.propertyId, input.propertyId))
    .orderBy(asc(visitLinks.revokedAt), asc(visitLinks.label));

  if (!rows.length) return [];

  const counts = await tx.select({
    visitLinkId: visits.visitLinkId,
    id: visits.id,
  }).from(visits).where(eq(visits.propertyId, input.propertyId));

  const byLink = new Map<string, number>();
  for (const v of counts) {
    if (!v.visitLinkId) continue;
    byLink.set(v.visitLinkId, (byLink.get(v.visitLinkId) ?? 0) + 1);
  }

  return rows.map((row) => ({
    ...row,
    kind: row.kind as VisitLinkKind,
    visitCount: byLink.get(row.id) ?? 0,
  }));
}

/** Open visits at a property, newest first — the "who is eating right now"
 *  read behind the admin list. */
export async function listOpenVisits(
  tx: Tx,
  input: { propertyId: string; limit?: number },
): Promise<Array<{
  id: string; fulfilment: string; status: string;
  customerName: string | null; tableLabel: string | null;
  deliveryAddress: string | null; createdAt: Date;
}>> {
  return tx.select({
    id: visits.id,
    fulfilment: visits.fulfilment,
    status: visits.status,
    customerName: visits.customerName,
    tableLabel: visits.tableLabel,
    deliveryAddress: visits.deliveryAddress,
    createdAt: visits.createdAt,
  }).from(visits)
    .where(and(eq(visits.propertyId, input.propertyId), eq(visits.status, 'OPEN')))
    .orderBy(desc(visits.createdAt))
    .limit(input.limit ?? 50);
}
