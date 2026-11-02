import { eq } from 'drizzle-orm';
import { recordEvent, type Tx } from '@/db';
import { properties } from '@/db/schema/identity';
import { NotFoundError, ValidationError } from '@/lib/errors';
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
    branding: {
      theme?: string | null; accent?: string | null; logoUrl?: string | null; coverUrl?: string | null;
    };
  },
): Promise<PropertyBranding> {
  const before = await getPropertyProfile(tx, input.propertyId);
  if (!before) throw new NotFoundError('No such property.');

  // A form that does not send a field keeps what the property has: the theme
  // and its draft belong to the theme picker, and the pre-theme accent (D-087)
  // is no longer offered by any form, so the logo form must not wipe it.
  const next = cleanBranding({
    ...input.branding,
    theme: input.branding.theme ?? before.branding.theme,
    draftTheme: before.branding.draftTheme,
    accent: input.branding.accent === undefined ? before.branding.accent : input.branding.accent,
  });
  return writeBranding(tx, input, before.branding, next);
}

/**
 * The theme picker (D-102). Picking a card saves a DRAFT — the console's
 * preview wears it, the guests' phones do not — and only `publishTheme()`
 * changes what a guest sees. All three are `property:branding`, checked by
 * the caller, the same as the form above.
 *
 * Saving a draft writes no event: nobody outside this screen can see it, and
 * the event log is the record of what guests were shown. Publishing writes
 * `property.branding_updated`, with the theme's from and to, as any other
 * branding change does.
 */
export async function saveThemeDraft(
  tx: Tx,
  input: { tenantId: string; propertyId: string; staffUserId: string; theme: string },
): Promise<PropertyBranding> {
  const before = await getPropertyProfile(tx, input.propertyId);
  if (!before) throw new NotFoundError('No such property.');
  const next = cleanBranding({ ...before.branding, draftTheme: input.theme });
  await tx.update(properties)
    .set({ branding: next, updatedAt: new Date() })
    .where(eq(properties.id, input.propertyId));
  return next;
}

/** Drop the draft; what guests see is untouched. */
export async function discardThemeDraft(
  tx: Tx,
  input: { tenantId: string; propertyId: string; staffUserId: string },
): Promise<PropertyBranding> {
  return saveThemeDraft(tx, { ...input, theme: '' });
}

/**
 * The draft goes live. Clears the pre-theme accent too: the screen no longer
 * shows it, so publishing what the preview shows means publishing without it.
 * With neither a draft nor such an accent there is nothing to publish, and it
 * says so.
 */
export async function publishTheme(
  tx: Tx,
  input: { tenantId: string; propertyId: string; staffUserId: string },
): Promise<PropertyBranding> {
  const before = await getPropertyProfile(tx, input.propertyId);
  if (!before) throw new NotFoundError('No such property.');
  // Kesari still wearing a pre-theme accent has something to publish with no
  // draft: the theme as the preview shows it, without that accent.
  if (!before.branding.draftTheme && !before.branding.accent) {
    throw new ValidationError('That theme is already the one guests see.');
  }
  const next = cleanBranding({
    ...before.branding,
    theme: before.branding.draftTheme ?? before.branding.theme,
    draftTheme: null,
    accent: null,
  });
  return writeBranding(tx, input, before.branding, next);
}

/** Store it, and log what a guest will now see differently — never the draft. */
async function writeBranding(
  tx: Tx,
  input: { tenantId: string; propertyId: string; staffUserId: string },
  before: PropertyBranding,
  next: PropertyBranding,
): Promise<PropertyBranding> {
  await tx.update(properties)
    .set({ branding: next, updatedAt: new Date() })
    .where(eq(properties.id, input.propertyId));

  const changed = Object.fromEntries(
    (Object.keys(next) as Array<keyof PropertyBranding>)
      .filter((field) => field !== 'draftTheme' && before[field] !== next[field])
      .map((field) => [field, { from: before[field], to: next[field] }]),
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
