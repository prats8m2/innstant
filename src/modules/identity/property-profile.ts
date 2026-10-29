import { eq } from 'drizzle-orm';
import { recordEvent, type Tx } from '@/db';
import { properties } from '@/db/schema/identity';
import { NotFoundError } from '@/lib/errors';
import { cleanBranding, readBranding, type PropertyBranding } from './branding';
import { cleanGuestInfo, type GuestInfo } from './guest-info';

export type { GuestInfo } from './guest-info';

/**
 * The parts of a property a GUEST reads: how to reach the hotel, when they
 * arrive and leave, the wifi, and what the hotel looks like (D-087).
 *
 * Kept apart from `property-settings.ts` — name, clock, currency — because the
 * two are different decisions with different blast radii. Moving the clock
 * changes what "today" means on every screen; changing the wifi password
 * changes one card. They are saved separately and logged separately, so the
 * event log can say which happened.
 */


export interface PropertyProfile {
  id: string;
  name: string;
  timezone: string;
  guestInfo: GuestInfo;
  branding: PropertyBranding;
}

export async function getPropertyProfile(
  tx: Tx,
  propertyId: string,
): Promise<PropertyProfile | null> {
  const rows = await tx.select({
    id: properties.id,
    name: properties.name,
    timezone: properties.timezone,
    branding: properties.branding,
    contactPhone: properties.contactPhone,
    contactWhatsapp: properties.contactWhatsapp,
    contactEmail: properties.contactEmail,
    addressLine: properties.addressLine,
    city: properties.city,
    checkInTime: properties.checkInTime,
    checkOutTime: properties.checkOutTime,
    wifiNetwork: properties.wifiNetwork,
    wifiPassword: properties.wifiPassword,
  }).from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  const { id, name, timezone, branding, ...guestInfo } = row;
  return { id, name, timezone, guestInfo, branding: readBranding(branding) };
}

export async function updateGuestInfo(
  tx: Tx,
  input: { tenantId: string; propertyId: string; staffUserId: string; info: GuestInfo },
): Promise<void> {
  const before = await getPropertyProfile(tx, input.propertyId);
  if (!before) throw new NotFoundError('No such property.');

  const next = cleanGuestInfo(input.info);
  await tx.update(properties)
    .set({ ...next, updatedAt: new Date() })
    .where(eq(properties.id, input.propertyId));

  // Which fields changed, never the values: a wifi password does not belong in
  // an audit trail that every READ_ONLY account can read.
  const changed = (Object.keys(next) as Array<keyof GuestInfo>)
    .filter((field) => before.guestInfo[field] !== next[field]);
  if (!changed.length) return;

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'property',
    entityId: input.propertyId,
    eventType: 'property.guest_info_updated',
    actor: { kind: 'STAFF', staffUserId: input.staffUserId },
    payload: { changed },
  });
}

/** `property:branding`, checked by the caller. Refuses an unreadable accent. */
export async function updateBranding(
  tx: Tx,
  input: {
    tenantId: string; propertyId: string; staffUserId: string;
    branding: { accent?: string | null; logoUrl?: string | null; coverUrl?: string | null };
  },
): Promise<PropertyBranding> {
  const before = await getPropertyProfile(tx, input.propertyId);
  if (!before) throw new NotFoundError('No such property.');

  const next = cleanBranding(input.branding);
  await tx.update(properties)
    .set({ branding: next, updatedAt: new Date() })
    .where(eq(properties.id, input.propertyId));

  const changed = Object.fromEntries(
    (Object.keys(next) as Array<keyof PropertyBranding>)
      .filter((field) => before.branding[field] !== next[field])
      .map((field) => [field, { from: before.branding[field], to: next[field] }]),
  );
  if (Object.keys(changed).length) {
    await recordEvent(tx, {
      tenantId: input.tenantId,
      propertyId: input.propertyId,
      entityType: 'property',
      entityId: input.propertyId,
      eventType: 'property.branding_updated',
      actor: { kind: 'STAFF', staffUserId: input.staffUserId },
      payload: { changed },
    });
  }
  return next;
}
