import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '@/db';
import { recordEvent } from '@/db';
import { guests, guestPropertyProfiles, stays } from '@/db/schema/stay';
import { findRoomAtProperty } from '@/modules/identity';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { notifyPms } from './pms/sync';

/**
 * The only place a stay is created. CLAUDE.md #4.
 *
 * Front desk, PMS import and the seeder all call this. When booking arrives it
 * becomes a fourth caller rather than a sixth code path someone has to find —
 * which is the whole point: D-007 makes Stay the aggregate root, and an
 * aggregate with several birth certificates is not one.
 *
 * ─── What this function owns ───────────────────────────────────────────────
 *
 * Three things that were previously nobody's job, because every caller inserted
 * the row itself:
 *
 *   1. The guest exists, and is matched on `(tenant_id, phone)` — the key that
 *      matters (EXTENSION-POINTS §2). A returning guest gets the same row, so
 *      their history follows them across properties in the group.
 *   2. The room is real, belongs to this property, and is not already occupied.
 *      D-007's partial unique index is the backstop; this turns the resulting
 *      23505 into a sentence someone at a front desk can act on.
 *   3. `event_log` gets `stay.created` in the SAME transaction (#7). A stay
 *      that appeared with no event is a stay nobody can account for, and this
 *      is the row every SLA and dispute query starts from.
 */

export interface CreateStayInput {
  tenantId: string;
  propertyId: string;
  roomId: string;

  guest: {
    fullName: string;
    /** The identity key. Optional only because a walk-in may refuse to give one. */
    phone?: string | null;
    email?: string | null;
    preferredLanguage?: string;
  };

  /** Defaults to CHECKED_IN: a front-desk arrival is the common case, and a
   *  RESERVED stay is what booking will add. */
  status?: 'RESERVED' | 'CHECKED_IN';
  source?: 'WALK_IN' | 'FRONT_DESK' | 'PMS_IMPORT';
  /** Opaque pointer back to whatever system produced this (§3). */
  sourceRefId?: string | null;

  scheduledCheckoutAt: Date;
  checkedInAt?: Date;
  adults?: number;
  children?: number;

  /** Who did this. A stay created by a person is attributed to that person. */
  actor?: { kind: 'STAFF'; staffUserId: string } | { kind: 'SYSTEM' };
}

export interface CreatedStay {
  stayId: string;
  guestId: string;
  /** True when this call created the guest rather than matching an existing one. */
  guestIsNew: boolean;
}

export async function createStay(tx: Tx, input: CreateStayInput): Promise<CreatedStay> {
  const status = input.status ?? 'CHECKED_IN';
  const fullName = input.guest.fullName.trim();
  if (!fullName) throw new ValidationError('A stay needs a guest name.');

  if (input.scheduledCheckoutAt.getTime() <= Date.now() - 24 * 60 * 60 * 1000) {
    // Not "must be in the future" — a PMS import backfilling yesterday is
    // legitimate. A checkout more than a day in the past is a data error.
    throw new ValidationError('That checkout date is in the past.');
  }

  const room = await assertRoomIsAvailable(tx, input, status);
  const { guestId, guestIsNew } = await findOrCreateGuest(tx, input);

  await ensurePropertyProfile(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    guestId,
  });

  const checkedInAt = status === 'CHECKED_IN' ? (input.checkedInAt ?? new Date()) : null;

  let stayId: string;
  try {
    const [row] = await tx.insert(stays).values({
      tenantId: input.tenantId,
      propertyId: input.propertyId,
      roomId: input.roomId,
      guestId,
      status,
      source: input.source ?? 'FRONT_DESK',
      sourceRefId: input.sourceRefId ?? null,
      checkedInAt,
      scheduledCheckoutAt: input.scheduledCheckoutAt,
      adults: input.adults ?? 1,
      children: input.children ?? 0,
    }).returning({ id: stays.id });
    stayId = row!.id;
  } catch (error) {
    // D-007's partial unique index, reached under real concurrency: two front
    // desk terminals checking two guests into the same room at the same
    // moment. Exactly one wins, and the loser gets a sentence rather than a
    // constraint name.
    if (isUniqueViolation(error)) {
      throw new ConflictError(
        `Room ${room.number} already has a guest checked in. Check them out first.`,
      );
    }
    throw error;
  }

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'stay',
    entityId: stayId,
    eventType: 'stay.created',
    toStatus: status,
    actor: input.actor ?? { kind: 'SYSTEM' },
    payload: {
      roomNumber: room.number,
      source: input.source ?? 'FRONT_DESK',
      guestIsNew,
    },
  });

  /**
   * And the system of record, if this property's is somewhere else (D-011).
   *
   * In the same transaction as the stay and the event: a queued "checked in"
   * that survives a rolled-back check-in is a message about a guest who is not
   * here. `notifyPms()` writes nothing at all for a manual property, which is
   * every property today.
   */
  if (status === 'CHECKED_IN') {
    await notifyPms(tx, {
      tenantId: input.tenantId,
      propertyId: input.propertyId,
      event: {
        kind: 'STAY_CHECKED_IN',
        stay: { stayId, sourceRefId: input.sourceRefId ?? null, roomNumber: room.number },
        guest: { fullName, phone: input.guest.phone ?? null },
        checkedInAt: (input.checkedInAt ?? new Date()).toISOString(),
        scheduledCheckoutAt: input.scheduledCheckoutAt.toISOString(),
      },
    });
  }

  return { stayId, guestId, guestIsNew };
}

async function assertRoomIsAvailable(
  tx: Tx,
  input: CreateStayInput,
  status: 'RESERVED' | 'CHECKED_IN',
): Promise<{ number: string }> {
  // Through identity's service, not its table: `rooms` belongs to identity
  // (D-001), and the boundary lint rule is what keeps that true.
  const room = await findRoomAtProperty(tx, {
    propertyId: input.propertyId,
    roomId: input.roomId,
  });
  if (!room) throw new NotFoundError('That room is not at this property.');

  if (status === 'CHECKED_IN') {
    const occupied = await tx
      .select({ id: stays.id })
      .from(stays)
      .where(and(eq(stays.roomId, input.roomId), eq(stays.status, 'CHECKED_IN')))
      .limit(1);
    if (occupied[0]) {
      throw new ConflictError(
        `Room ${room.number} already has a guest checked in. Check them out first.`,
      );
    }
  }

  return room;
}

/**
 * Matched on `(tenant_id, phone)` — tenant-wide, never per property
 * (EXTENSION-POINTS §2). Widening that later would mean merging duplicate guest
 * rows that already exist, and there is no clean automated answer to "are these
 * two Anjali Menons the same person" once the data is real.
 *
 * With no phone there is nothing to match on, so a new guest row is created.
 * That is the honest outcome: an anonymous walk-in has no identity to reuse.
 */
/**
 * The same match, for somebody who has no stay at all. D-079.
 *
 * A restaurant customer ordering through a property link is a person this
 * tenant may already know — the regular who eats here every Thursday, or the
 * guest who stayed last March and whose number is already on a `guests` row.
 * EXTENSION-POINTS §2 made the key `(tenant_id, phone)` precisely so that
 * recognising them is a lookup rather than a reconciliation script.
 *
 * It lives in THIS file, and is exported through the module interface, because
 * `guests` is the stay module's table (D-001) and `modules/visit` may not
 * reach it. The matching rule has one implementation for the same reason
 * `createStay()` is one door: two of them would eventually disagree about who
 * counts as the same person.
 *
 * The existing row's NAME is deliberately left alone. A guest called "Anjali
 * Menon" on her folio who types "anj" into a takeaway form has not renamed
 * herself, and the visit keeps what she typed as its own snapshot.
 */
export async function upsertGuestByPhone(
  tx: Tx,
  input: { tenantId: string; phone: string; fullName: string },
): Promise<string> {
  const phone = input.phone.trim();

  const existing = await tx
    .select({ id: guests.id })
    .from(guests)
    .where(and(eq(guests.tenantId, input.tenantId), eq(guests.phone, phone)))
    .limit(1);
  if (existing[0]) return existing[0].id;

  const [created] = await tx.insert(guests).values({
    tenantId: input.tenantId,
    fullName: input.fullName.trim(),
    phone,
  }).returning({ id: guests.id });

  return created!.id;
}

async function findOrCreateGuest(
  tx: Tx,
  input: CreateStayInput,
): Promise<{ guestId: string; guestIsNew: boolean }> {
  const phone = input.guest.phone?.trim() || null;

  if (phone) {
    const existing = await tx
      .select({ id: guests.id })
      .from(guests)
      .where(and(eq(guests.tenantId, input.tenantId), eq(guests.phone, phone)))
      .limit(1);
    if (existing[0]) return { guestId: existing[0].id, guestIsNew: false };
  }

  const [created] = await tx.insert(guests).values({
    tenantId: input.tenantId,
    fullName: input.guest.fullName.trim(),
    phone,
    email: input.guest.email?.trim() || null,
    preferredLanguage: input.guest.preferredLanguage ?? 'en',
  }).returning({ id: guests.id });

  return { guestId: created!.id, guestIsNew: true };
}

/** The property-local view of a tenant-wide guest. Created empty; the front
 *  desk fills in the VIP flag and the allergy note later. */
async function ensurePropertyProfile(
  tx: Tx,
  input: { tenantId: string; propertyId: string; guestId: string },
): Promise<void> {
  await tx.insert(guestPropertyProfiles).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    guestId: input.guestId,
  }).onConflictDoNothing();
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

/**
 * The stay a guest is currently on, for a room. Used by the front desk and by
 * checkout; guest sessions carry `stay_id` already (#10) and must not look a
 * stay up by room.
 */
export async function activeStayForRoom(
  tx: Tx,
  roomId: string,
): Promise<{ stayId: string; guestId: string } | null> {
  const rows = await tx
    .select({ stayId: stays.id, guestId: stays.guestId })
    .from(stays)
    .where(and(eq(stays.roomId, roomId), eq(stays.status, 'CHECKED_IN')))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * What the property knows about the guest on this stay.
 *
 * One read for both facts a charge needs: the dietary flags the kitchen ticket
 * copies (DATA-MODEL §4) and whether the desk has blocked charges to this room.
 *
 * `chargingBlocked` sat in the schema unread until a sweep found it. It is the
 * flag a front desk sets when a card has been declined or a guest disputes
 * everything, and a charge path that ignores it is a charge path that overrules
 * the desk.
 */
export interface StayGuestProfile {
  dietaryFlags: string[];
  chargingBlocked: boolean;
  isVip: boolean;
}

export async function guestProfileForStay(
  tx: Tx,
  input: { propertyId: string; stayId: string },
): Promise<StayGuestProfile> {
  const rows = await tx
    .select({
      flags: guestPropertyProfiles.dietaryFlags,
      chargingBlocked: guestPropertyProfiles.chargingBlocked,
      isVip: guestPropertyProfiles.isVip,
    })
    .from(stays)
    .innerJoin(guestPropertyProfiles, and(
      eq(guestPropertyProfiles.guestId, stays.guestId),
      eq(guestPropertyProfiles.propertyId, input.propertyId),
    ))
    .where(eq(stays.id, input.stayId))
    .limit(1);

  const row = rows[0];
  return {
    dietaryFlags: Array.isArray(row?.flags) ? (row.flags as string[]) : [],
    // No profile row means nothing is known, which is not the same as blocked.
    chargingBlocked: row?.chargingBlocked ?? false,
    isVip: row?.isVip ?? false,
  };
}

/** Dietary flags alone, for callers that only need the kitchen ticket. */
export async function dietaryFlagsForStay(
  tx: Tx,
  input: { propertyId: string; stayId: string },
): Promise<string[]> {
  return (await guestProfileForStay(tx, input)).dietaryFlags;
}

/** Guarded so a caller cannot accidentally count another property's stays. */
export async function countActiveStays(tx: Tx, propertyId: string): Promise<number> {
  const rows = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(stays)
    .where(and(eq(stays.propertyId, propertyId), eq(stays.status, 'CHECKED_IN')));
  return rows[0]?.n ?? 0;
}
