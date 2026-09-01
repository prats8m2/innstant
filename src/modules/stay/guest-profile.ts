import { and, desc, eq, sql } from 'drizzle-orm';
import { recordEvent, type Tx } from '@/db';
import { guests, guestPropertyProfiles, stays } from '@/db/schema/stay';
import { lifetimeSpendForGuest } from '@/modules/billing';
import { NotFoundError, ValidationError } from '@/lib/errors';
import type { CurrencyCode } from '@/lib/money';

/**
 * A guest, everything this property knows about them.
 *
 * ─── Why the guest is tenant-scoped and the profile is not ─────────────────
 *
 * `guests` is keyed on `(tenant_id, phone)` and never on property
 * (EXTENSION-POINTS §2), so a group's returning guest is one row and their
 * history follows them between hotels. What each hotel thinks of them —
 * VIP, a charging hold, dietary flags, the note somebody left at 2am — is
 * `guest_property_profiles`, one row per property.
 *
 * This function reads both and shows the property's own view. Stays at SISTER
 * properties are counted and not detailed: they are the same customer to the
 * tenant and none of this front desk's business in detail (D-036).
 */

export const DIETARY_FLAGS = [
  'VEGETARIAN', 'VEGAN', 'JAIN', 'HALAL', 'NUT_ALLERGY', 'GLUTEN_FREE', 'DAIRY_FREE',
] as const;

export type DietaryFlag = (typeof DIETARY_FLAGS)[number];

export interface GuestStaySummary {
  id: string;
  status: string;
  roomNumber: string;
  checkedInAt: Date | null;
  checkedOutAt: Date | null;
  scheduledCheckoutAt: Date;
  balanceMinor: number | null;
  currency: CurrencyCode;
}

export interface GuestDossier {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  preferredLanguage: string;

  isVip: boolean;
  chargingBlocked: boolean;
  staffNotes: string | null;
  dietaryFlags: DietaryFlag[];

  /** Stays at THIS property, newest first. */
  stays: GuestStaySummary[];
  /** The one they are on now, if any. */
  currentStayId: string | null;

  lifetimeChargesMinor: number;
  currency: CurrencyCode;
  /** Stays at other properties in the group. A count, deliberately (D-036). */
  staysElsewhere: number;
}

export async function getGuestDossier(
  tx: Tx,
  input: { propertyId: string; guestId: string },
): Promise<GuestDossier | null> {
  const guestRows = await tx.select({
    id: guests.id,
    fullName: guests.fullName,
    phone: guests.phone,
    email: guests.email,
    preferredLanguage: guests.preferredLanguage,
  }).from(guests).where(eq(guests.id, input.guestId)).limit(1);

  const guest = guestRows[0];
  if (!guest) return null;

  const profileRows = await tx.select({
    isVip: guestPropertyProfiles.isVip,
    chargingBlocked: guestPropertyProfiles.chargingBlocked,
    staffNotes: guestPropertyProfiles.staffNotes,
    dietaryFlags: guestPropertyProfiles.dietaryFlags,
  }).from(guestPropertyProfiles)
    .where(and(
      eq(guestPropertyProfiles.guestId, input.guestId),
      eq(guestPropertyProfiles.propertyId, input.propertyId),
    ))
    .limit(1);

  const profile = profileRows[0];

  /**
   * Stays and their rooms. Raw SQL for the join to `rooms`, which identity owns
   * — the same narrow read-only projection the floor board and the desk's
   * checkout queue already take (D-001). RLS still applies to every row, and the
   * property filter is explicit because the policies are tenant-scoped: without
   * it a group's other hotels would appear here.
   */
  const stayRows = await tx.execute<{
    id: string; status: string; room_number: string;
    checked_in_at: Date | null; checked_out_at: Date | null;
    scheduled_checkout_at: Date;
    balance_minor: number | null; currency: string | null;
  }>(sql`
    SELECT s.id, s.status, rm.number AS room_number,
           s.checked_in_at, s.checked_out_at, s.scheduled_checkout_at,
           f.balance_minor, f.currency
    FROM stays s
    JOIN rooms rm ON rm.id = s.room_id
    LEFT JOIN folios f ON f.stay_id = s.id
    WHERE s.property_id = ${input.propertyId}
      AND s.guest_id = ${input.guestId}
    ORDER BY s.created_at DESC
  `);

  const elsewhere = await tx.select({ n: sql<number>`count(*)::int` })
    .from(stays)
    .where(and(eq(stays.guestId, input.guestId), sql`${stays.propertyId} <> ${input.propertyId}`));

  const spend = await lifetimeSpendForGuest(tx, {
    propertyId: input.propertyId,
    guestId: input.guestId,
  });

  const staySummaries: GuestStaySummary[] = stayRows.rows.map((row) => ({
    id: row.id,
    status: row.status,
    roomNumber: row.room_number,
    checkedInAt: row.checked_in_at ? new Date(row.checked_in_at) : null,
    checkedOutAt: row.checked_out_at ? new Date(row.checked_out_at) : null,
    scheduledCheckoutAt: new Date(row.scheduled_checkout_at),
    balanceMinor: row.balance_minor === null ? null : Number(row.balance_minor),
    currency: (row.currency ?? spend.currency) as CurrencyCode,
  }));

  return {
    ...guest,
    isVip: profile?.isVip ?? false,
    chargingBlocked: profile?.chargingBlocked ?? false,
    staffNotes: profile?.staffNotes ?? null,
    dietaryFlags: Array.isArray(profile?.dietaryFlags)
      ? (profile.dietaryFlags as DietaryFlag[])
      : [],
    stays: staySummaries,
    currentStayId: staySummaries.find((stay) => stay.status === 'CHECKED_IN')?.id ?? null,
    lifetimeChargesMinor: spend.chargesMinor,
    currency: spend.currency as CurrencyCode,
    staysElsewhere: Number(elsewhere[0]?.n ?? 0),
  };
}

export interface UpdateGuestProfileInput {
  tenantId: string;
  propertyId: string;
  guestId: string;
  isVip: boolean;
  chargingBlocked: boolean;
  staffNotes: string | null;
  dietaryFlags: readonly string[];
  staffUserId: string;
}

/**
 * What this property thinks of them.
 *
 * Upserts, because a guest created by `createStay()` has a profile row and one
 * arriving another way may not — and the desk pressing save should not depend on
 * which.
 *
 * ─── Why the event carries a diff ──────────────────────────────────────────
 *
 * Two of these fields change what the product does. `charging_blocked` stops
 * every charge to the room (`placeOrder`, and `raiseServiceRequest` as of this
 * change), and `dietary_flags` reaches the kitchen on every ticket the guest
 * sends. "Who put a hold on 214, and when" has to be answerable, and so does
 * "who took the nut allergy off".
 */
export async function updateGuestProfile(
  tx: Tx,
  input: UpdateGuestProfileInput,
): Promise<void> {
  const unknown = input.dietaryFlags.filter(
    (flag) => !DIETARY_FLAGS.includes(flag as DietaryFlag),
  );
  if (unknown.length) {
    throw new ValidationError(`The kitchen does not know "${unknown[0]}".`);
  }

  const notes = input.staffNotes?.trim() || null;
  if (notes && notes.length > 2000) {
    throw new ValidationError('Keep the note under 2000 characters.');
  }

  const exists = await tx.select({ id: guests.id }).from(guests)
    .where(eq(guests.id, input.guestId)).limit(1);
  if (!exists[0]) throw new NotFoundError('No such guest.');

  const before = await tx.select({
    isVip: guestPropertyProfiles.isVip,
    chargingBlocked: guestPropertyProfiles.chargingBlocked,
    staffNotes: guestPropertyProfiles.staffNotes,
    dietaryFlags: guestPropertyProfiles.dietaryFlags,
  }).from(guestPropertyProfiles)
    .where(and(
      eq(guestPropertyProfiles.guestId, input.guestId),
      eq(guestPropertyProfiles.propertyId, input.propertyId),
    ))
    .limit(1);

  const previous = before[0];
  const flags = [...new Set(input.dietaryFlags)].sort();

  await tx.insert(guestPropertyProfiles).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    guestId: input.guestId,
    isVip: input.isVip,
    chargingBlocked: input.chargingBlocked,
    staffNotes: notes,
    dietaryFlags: flags,
  }).onConflictDoUpdate({
    target: [guestPropertyProfiles.propertyId, guestPropertyProfiles.guestId],
    set: {
      isVip: input.isVip,
      chargingBlocked: input.chargingBlocked,
      staffNotes: notes,
      dietaryFlags: flags,
      updatedAt: new Date(),
    },
  });

  const wasFlags = Array.isArray(previous?.dietaryFlags)
    ? [...(previous.dietaryFlags as string[])].sort()
    : [];

  const changed: Record<string, { from: unknown; to: unknown }> = {};
  if ((previous?.isVip ?? false) !== input.isVip) {
    changed.isVip = { from: previous?.isVip ?? false, to: input.isVip };
  }
  if ((previous?.chargingBlocked ?? false) !== input.chargingBlocked) {
    changed.chargingBlocked = {
      from: previous?.chargingBlocked ?? false, to: input.chargingBlocked,
    };
  }
  if ((previous?.staffNotes ?? null) !== notes) {
    changed.staffNotes = { from: previous?.staffNotes ?? null, to: notes };
  }
  if (wasFlags.join(',') !== flags.join(',')) {
    changed.dietaryFlags = { from: wasFlags, to: flags };
  }

  // Nothing moved — a save that changed nothing is not an audit event.
  if (!Object.keys(changed).length) return;

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'guest',
    entityId: input.guestId,
    eventType: 'guest.profile_updated',
    actor: { kind: 'STAFF', staffUserId: input.staffUserId },
    payload: { changed },
  });
}

/**
 * Who is this, from a stay.
 *
 * The desk arrives from the room board, which knows the stay and not the guest.
 */
export async function guestIdForStay(
  tx: Tx,
  input: { propertyId: string; stayId: string },
): Promise<string | null> {
  const rows = await tx.select({ guestId: stays.guestId }).from(stays)
    .where(and(eq(stays.id, input.stayId), eq(stays.propertyId, input.propertyId)))
    .limit(1);
  return rows[0]?.guestId ?? null;
}

/** Everyone who has ever stayed here, newest arrival first. For a search box. */
export async function recentGuests(
  tx: Tx,
  input: { propertyId: string; limit?: number },
): Promise<Array<{ id: string; fullName: string; phone: string | null; lastStayAt: Date }>> {
  const rows = await tx.select({
    id: guests.id,
    fullName: guests.fullName,
    phone: guests.phone,
    lastStayAt: sql<Date>`max(${stays.createdAt})`,
  }).from(stays)
    .innerJoin(guests, eq(guests.id, stays.guestId))
    .where(eq(stays.propertyId, input.propertyId))
    .groupBy(guests.id, guests.fullName, guests.phone)
    .orderBy(desc(sql`max(${stays.createdAt})`))
    .limit(input.limit ?? 50);

  return rows.map((row) => ({ ...row, lastStayAt: new Date(row.lastStayAt) }));
}
