import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { recordEvent, type Tx } from '@/db';
import { requestTypes, serviceRequests } from '@/db/schema/requests';
import { NotFoundError, ValidationError, ConflictError } from '@/lib/errors';
import type { CurrencyCode } from '@/lib/money';
import { OPEN_REQUEST_STATUSES } from './transitions';
import {
  checkRequestTypeRules, deriveRequestTypeFields, requestTypeKeyFrom, uniqueRequestTypeKey,
  type RequestCategory,
} from './type-rules';

/**
 * `request_types`, editable.
 *
 * Until this file existed, "towels in 12 minutes" was a line in `provision.ts`
 * and the only way a property could change it was to re-run the seeder — which
 * also wipes the property. Every column here has been written since S6 and read
 * by the guest screens, the routing and the SLA sweep; none of them was
 * reachable by the people who own the answer.
 *
 * The screen behind this is `/admin/requests`, gated on `request_type:manage`.
 */

export interface AdminRequestType {
  id: string;
  /** Immutable. Code finds `CALL_SERVICE` by it and a rename must not move it. */
  key: string;
  name: string;
  description: string | null;
  category: RequestCategory;
  priceMinor: number;
  currency: CurrencyCode;
  isChargeable: boolean;
  slaMinutes: number;
  routeToRoleKey: string;
  allowsQuantity: boolean;
  maxQuantity: number;
  allowsNote: boolean;
  allowsPhoto: boolean;
  isActive: boolean;
  sortOrder: number;
  /** Requests of this type nobody has finished with. Shown before archiving. */
  liveCount: number;
}

const COLUMNS = {
  id: requestTypes.id,
  key: requestTypes.key,
  name: requestTypes.name,
  description: requestTypes.description,
  category: requestTypes.category,
  priceMinor: requestTypes.priceMinor,
  currency: requestTypes.currency,
  isChargeable: requestTypes.isChargeable,
  slaMinutes: requestTypes.slaMinutes,
  routeToRoleKey: requestTypes.routeToRoleKey,
  allowsQuantity: requestTypes.allowsQuantity,
  maxQuantity: requestTypes.maxQuantity,
  allowsNote: requestTypes.allowsNote,
  allowsPhoto: requestTypes.allowsPhoto,
  isActive: requestTypes.isActive,
  sortOrder: requestTypes.sortOrder,
};

/**
 * Everything this property offers, switched off ones included.
 *
 * Unlike `getRequestCatalog()`, which is the guest's view: that one filters to
 * active and unarchived, because a guest must never see something they cannot
 * ask for. This one has to show the switched-off ones or they would be
 * unreachable — a property that turned turndown off for the season needs the row
 * in order to turn it back on.
 *
 * Archived stays hidden in both. That is the difference between the two states
 * and the reason there are two: off is a season, archived is for good.
 */
export async function getAdminRequestTypes(
  tx: Tx,
  input: { propertyId: string },
): Promise<AdminRequestType[]> {
  const rows = await tx.select(COLUMNS).from(requestTypes)
    .where(and(
      eq(requestTypes.propertyId, input.propertyId),
      isNull(requestTypes.archivedAt),
    ))
    .orderBy(asc(requestTypes.sortOrder), asc(requestTypes.name));

  if (!rows.length) return [];

  /**
   * One grouped count for the whole list, not one query per type. There are
   * twenty-three of these on a seeded property and this screen is rendered on
   * every visit.
   */
  const counts = await tx.select({
    requestTypeId: serviceRequests.requestTypeId,
    n: sql<number>`count(*)::int`,
  }).from(serviceRequests)
    .where(and(
      eq(serviceRequests.propertyId, input.propertyId),
      inArray(serviceRequests.status, [...OPEN_REQUEST_STATUSES]),
    ))
    .groupBy(serviceRequests.requestTypeId);

  const liveBy = new Map(counts.map((row) => [row.requestTypeId, Number(row.n)]));

  return rows.map((row) => ({
    ...row,
    category: row.category as RequestCategory,
    currency: row.currency as CurrencyCode,
    liveCount: liveBy.get(row.id) ?? 0,
  }));
}

export interface RequestTypeWriteInput {
  tenantId: string;
  propertyId: string;
  name: string;
  description?: string | null;
  category: string;
  priceMinor: number;
  slaMinutes: number;
  routeToRoleKey: string;
  allowsQuantity: boolean;
  maxQuantity: number;
  allowsNote: boolean;
  allowsPhoto: boolean;
  actorStaffId: string;
}

export interface UpdateRequestTypeInput extends RequestTypeWriteInput {
  requestTypeId: string;
}

/**
 * A new thing a guest may ask for.
 *
 * The key is minted here from the name and never editable afterwards. That is
 * the one field the manager does not get: it is how `CALL_SERVICE` is found, and
 * a key that moved when someone fixed a typo would break the one-tap screen with
 * no error anywhere.
 */
export async function createRequestType(
  tx: Tx,
  input: RequestTypeWriteInput & { currency?: string },
): Promise<{ id: string; key: string }> {
  const name = cleanName(input.name);
  const base = requestTypeKeyFrom(name);
  if (!base) {
    throw new ValidationError('Give it a name with some letters or numbers in it.');
  }

  await assertRoleExists(tx, input.propertyId, input.routeToRoleKey);

  const existing = await tx.select({
    key: requestTypes.key,
    sortOrder: requestTypes.sortOrder,
  }).from(requestTypes).where(eq(requestTypes.propertyId, input.propertyId));

  // Against EVERY key at the property, archived ones included: the unique index
  // does not know about `archived_at`, so reusing an archived key is a 23505
  // rather than a message.
  const key = uniqueRequestTypeKey(base, new Set(existing.map((row) => row.key)));

  const derived = enforce({ ...input, key, name });

  const [created] = await tx.insert(requestTypes).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    key,
    name,
    description: cleanDescription(input.description),
    category: input.category,
    priceMinor: input.priceMinor,
    currency: input.currency ?? 'INR',
    isChargeable: derived.isChargeable,
    slaMinutes: input.slaMinutes,
    routeToRoleKey: input.routeToRoleKey,
    allowsQuantity: input.allowsQuantity,
    maxQuantity: derived.maxQuantity,
    allowsNote: input.allowsNote,
    allowsPhoto: input.allowsPhoto,
    // On the end of the list. Reordering is a separate decision and there is no
    // screen for it yet; alphabetical-within-sort-order is what the guest gets.
    sortOrder: existing.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1,
  }).returning({ id: requestTypes.id, key: requestTypes.key });

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'request_type',
    entityId: created!.id,
    eventType: 'request_type.created',
    actor: { kind: 'STAFF', staffUserId: input.actorStaffId },
    payload: { key, name, category: input.category, slaMinutes: input.slaMinutes },
  });

  return created!;
}

/**
 * Edit one. Everything except the key.
 *
 * The event carries a `changed` diff rather than the whole row — "who moved
 * towels from twelve minutes to five, and when" is the question this gets asked,
 * and a full snapshot makes it a spot-the-difference puzzle.
 */
export async function updateRequestType(
  tx: Tx,
  input: UpdateRequestTypeInput,
): Promise<void> {
  const name = cleanName(input.name);
  await assertRoleExists(tx, input.propertyId, input.routeToRoleKey);

  const before = await tx.select({
    key: requestTypes.key,
    name: requestTypes.name,
    description: requestTypes.description,
    category: requestTypes.category,
    priceMinor: requestTypes.priceMinor,
    slaMinutes: requestTypes.slaMinutes,
    routeToRoleKey: requestTypes.routeToRoleKey,
    allowsQuantity: requestTypes.allowsQuantity,
    maxQuantity: requestTypes.maxQuantity,
    allowsNote: requestTypes.allowsNote,
    allowsPhoto: requestTypes.allowsPhoto,
  }).from(requestTypes)
    .where(and(
      eq(requestTypes.id, input.requestTypeId),
      eq(requestTypes.propertyId, input.propertyId),
      isNull(requestTypes.archivedAt),
    ))
    .limit(1);

  const previous = before[0];
  if (!previous) throw new NotFoundError('No such request type at this property.');

  // The rules are checked against the STORED key, never one from the form.
  const derived = enforce({ ...input, key: previous.key, name });

  const next = {
    name,
    description: cleanDescription(input.description),
    category: input.category,
    priceMinor: input.priceMinor,
    slaMinutes: input.slaMinutes,
    routeToRoleKey: input.routeToRoleKey,
    allowsQuantity: input.allowsQuantity,
    maxQuantity: derived.maxQuantity,
    allowsNote: input.allowsNote,
    allowsPhoto: input.allowsPhoto,
  };

  await tx.update(requestTypes)
    .set({ ...next, isChargeable: derived.isChargeable, updatedAt: new Date() })
    .where(eq(requestTypes.id, input.requestTypeId));

  const changed = Object.fromEntries(
    (Object.keys(next) as Array<keyof typeof next>)
      .filter((field) => previous[field] !== next[field])
      .map((field) => [field, { from: previous[field], to: next[field] }]),
  );

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'request_type',
    entityId: input.requestTypeId,
    eventType: 'request_type.updated',
    actor: { kind: 'STAFF', staffUserId: input.actorStaffId },
    payload: { key: previous.key, name, changed },
  });
}

/**
 * Off for the season, or back on.
 *
 * Reversible and separate from archiving, which is not. A switched-off type
 * disappears from the guest's list and stops being raisable; requests already
 * open against it carry on, because their lines snapshot the label (#6) and the
 * board does not read this table.
 */
export async function setRequestTypeActive(
  tx: Tx,
  input: {
    tenantId: string;
    propertyId: string;
    requestTypeId: string;
    isActive: boolean;
    actorStaffId: string;
  },
): Promise<void> {
  const updated = await tx.update(requestTypes)
    .set({ isActive: input.isActive, updatedAt: new Date() })
    .where(and(
      eq(requestTypes.id, input.requestTypeId),
      eq(requestTypes.propertyId, input.propertyId),
      isNull(requestTypes.archivedAt),
    ))
    .returning({ key: requestTypes.key, name: requestTypes.name });

  const row = updated[0];
  if (!row) throw new NotFoundError('No such request type at this property.');

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'request_type',
    entityId: input.requestTypeId,
    eventType: input.isActive ? 'request_type.activated' : 'request_type.deactivated',
    actor: { kind: 'STAFF', staffUserId: input.actorStaffId },
    payload: { key: row.key, name: row.name },
  });
}

/**
 * For good. Archived, never deleted (D-008).
 *
 * The FK from `service_requests` is ON DELETE SET NULL and exists for analytics;
 * a deleted row would blank it on every request this type ever produced. The
 * archived row stays and history keeps resolving.
 *
 * Refused while requests are still open against it, for the same reason the menu
 * refuses to archive a section holding dishes: the person doing the tidying is
 * not the person holding the trolley, and a type that vanishes mid-shift takes
 * its "what is this for" with it. Finish them, or switch the type off and let
 * them drain.
 */
export async function archiveRequestType(
  tx: Tx,
  input: {
    tenantId: string;
    propertyId: string;
    requestTypeId: string;
    actorStaffId: string;
  },
): Promise<void> {
  const rows = await tx.select({ key: requestTypes.key, name: requestTypes.name })
    .from(requestTypes)
    .where(and(
      eq(requestTypes.id, input.requestTypeId),
      eq(requestTypes.propertyId, input.propertyId),
      isNull(requestTypes.archivedAt),
    ))
    .limit(1);

  const row = rows[0];
  if (!row) throw new NotFoundError('No such request type at this property.');

  const live = await tx.select({ n: sql<number>`count(*)::int` })
    .from(serviceRequests)
    .where(and(
      eq(serviceRequests.propertyId, input.propertyId),
      eq(serviceRequests.requestTypeId, input.requestTypeId),
      inArray(serviceRequests.status, [...OPEN_REQUEST_STATUSES]),
    ));

  const open = Number(live[0]?.n ?? 0);
  if (open > 0) {
    throw new ConflictError(
      open === 1
        ? 'One request of this kind is still open. Finish it first, or switch the type off instead.'
        : `${open} requests of this kind are still open. Finish them first, or switch the type off instead.`,
    );
  }

  const now = new Date();
  await tx.update(requestTypes)
    .set({ archivedAt: now, isActive: false, updatedAt: now })
    .where(eq(requestTypes.id, input.requestTypeId));

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'request_type',
    entityId: input.requestTypeId,
    eventType: 'request_type.archived',
    actor: { kind: 'STAFF', staffUserId: input.actorStaffId },
    payload: { key: row.key, name: row.name },
  });
}

/* ── The bits both writes share ─────────────────────────────────────────── */

function cleanName(value: string): string {
  const name = value.trim();
  if (!name) throw new ValidationError('Give it a name a guest would recognise.');
  if (name.length > 120) throw new ValidationError('That name is too long for a card.');
  return name;
}

function cleanDescription(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  if (text.length > 400) throw new ValidationError('Keep the line under 400 characters.');
  return text || null;
}

/** The pure rules, thrown rather than returned. */
function enforce(input: {
  key: string;
  name: string;
  category: string;
  priceMinor: number;
  slaMinutes: number;
  allowsQuantity: boolean;
  maxQuantity: number;
}): { isChargeable: boolean; maxQuantity: number } {
  const violation = checkRequestTypeRules(input);
  if (violation) throw new ValidationError(violation.message);
  return deriveRequestTypeFields(input);
}

/**
 * The role has to exist, or routing quietly never happens.
 *
 * `routeServiceRequest()` matches this key against the roles staff hold at the
 * property. A typo, or a role that was never created here, produces a
 * `NOBODY_WITH_ROLE` event on every request of this type for ever — the routing
 * working exactly as designed, and nobody coming. Catching it at the form is
 * the only place it is cheap.
 *
 * Existence, not headcount: a property setting up its rota before its staff is
 * doing the normal thing, and refusing that would be wrong. The screen shows
 * the headcount so an empty role is visible rather than silent.
 */
async function assertRoleExists(
  tx: Tx,
  propertyId: string,
  roleKey: string,
): Promise<void> {
  const key = roleKey.trim();
  if (!key) throw new ValidationError('Say who this should go to.');

  const rows = await tx.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM roles
    WHERE key = ${key}
      AND (property_id IS NULL OR property_id = ${propertyId})
  `);

  if (!Number(rows.rows[0]?.n ?? 0)) {
    throw new ValidationError(
      `No role called "${key}" here. Requests routed to a role nobody holds are never assigned.`,
    );
  }
}
