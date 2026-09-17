import { eq, sql } from 'drizzle-orm';
import { recordEvent, type Tx } from '@/db';
import { properties } from '@/db/schema/identity';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';

/**
 * The hotel's own settings: what it is called, what time it is there, and what
 * it charges in.
 *
 * P3.5. `property:update` has been a declared permission since S5 with nothing
 * calling it — `provisionProperty()` set these three once and nothing could ever
 * change them, so a hotel that rebranded, or one provisioned into the wrong
 * timezone by a typo, had a database write as its only route.
 *
 * `branding` is deliberately not here. It is the theme editor, it is a WCAG-
 * validated token set rather than a text field (D-016), and it belongs to P5.
 */

export interface PropertySettingsInput {
  tenantId: string;
  propertyId: string;
  name: string;
  /** IANA. Everything a human reads is rendered in this zone, never the server's. */
  timezone: string;
  currency: string;
  staffUserId: string;
}

export async function updatePropertySettings(
  tx: Tx,
  input: PropertySettingsInput,
): Promise<void> {
  const name = cleanName(input.name);
  const timezone = cleanTimezone(input.timezone);
  const currency = cleanCurrency(input.currency);

  const before = await tx.select({
    name: properties.name,
    timezone: properties.timezone,
    currency: properties.currency,
  }).from(properties)
    .where(eq(properties.id, input.propertyId))
    .limit(1);

  const previous = before[0];
  if (!previous) throw new NotFoundError('No such property.');

  if (currency !== previous.currency && !(await currencyIsStillOpen(tx, input.propertyId))) {
    throw new ConflictError(
      `This property has already charged in ${previous.currency}, and nothing converts a past bill. `
      + 'The currency can only be set before the first order.',
    );
  }

  const next = { name, timezone, currency };

  await tx.update(properties)
    .set({ ...next, updatedAt: new Date() })
    .where(eq(properties.id, input.propertyId));

  const changed = Object.fromEntries(
    (Object.keys(next) as Array<keyof typeof next>)
      .filter((field) => previous[field] !== next[field])
      .map((field) => [field, { from: previous[field], to: next[field] }]),
  );
  if (!Object.keys(changed).length) return;

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'property',
    entityId: input.propertyId,
    eventType: 'property.updated',
    actor: { kind: 'STAFF', staffUserId: input.staffUserId },
    payload: { changed },
  });
}

/**
 * Whether the currency can still be changed — which is only before the first
 * charge, and this is why.
 *
 * #5: every row holding an amount carries its OWN currency beside its
 * `*_minor` integer. Changing `properties.currency` converts nothing and is not
 * meant to — a folio line written in INR stays INR for ever, which is correct,
 * because it is what the guest was actually charged. But the moment the property
 * switches, new lines land on the SAME folio in the new currency, and
 * `buildGuestStatement()` would total a bill whose rows do not agree. There is
 * no exchange rate anywhere in this product, and inventing one at render time to
 * make a total look tidy would be the worst possible place for it.
 *
 * So the switch is allowed only while the property has never priced anything:
 * during setup, before the first order, which is the only moment it is safe and
 * realistically the only moment anybody wants it.
 *
 * ONE query, used by both the screen and the guard. The screen calls it to say
 * so before somebody types, and `updatePropertySettings()` calls it again inside
 * the SAME transaction as the write, so a first order placed between the two
 * cannot slip through. Two different queries here would be two answers to the
 * same question, and the screen's would be the one people trusted.
 *
 * Raw SQL across three other modules' tables is D-001's narrow read-only
 * exception, and RLS still applies to every row it touches.
 */
export async function currencyIsStillOpen(tx: Tx, propertyId: string): Promise<boolean> {
  const priced = await tx.execute<{ one: number }>(sql`
    SELECT 1 AS one WHERE EXISTS (
      SELECT 1 FROM orders      WHERE property_id = ${propertyId}
      UNION ALL
      SELECT 1 FROM folio_lines WHERE property_id = ${propertyId}
      UNION ALL
      SELECT 1 FROM payments    WHERE property_id = ${propertyId}
    )
  `);
  return priced.rows.length === 0;
}

function cleanName(value: string): string {
  const name = value.trim();
  if (!name) throw new ValidationError('Give the property a name.');
  if (name.length > 120) throw new ValidationError('That name is too long.');
  return name;
}

/**
 * Validated against the runtime's own tz database rather than a list we keep.
 *
 * A typo here is not cosmetic: kitchen hours, availability windows, business-day
 * rollovers and every time a guest reads are property-local (CLAUDE.md "Dates").
 * "Asia/Calcutta" is a real alias and passes; "Asia/Kolkatta" is not and must not
 * be stored, because the failure would surface as a guest reading "by 3:26 am"
 * weeks later rather than as an error here.
 */
function cleanTimezone(value: string): string {
  const timezone = value.trim();
  if (!timezone) throw new ValidationError('Pick a timezone.');
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone }).format(new Date());
  } catch {
    throw new ValidationError(`${timezone} is not a timezone. Use an IANA name, like Asia/Kolkata.`);
  }
  return timezone;
}

/** ISO 4217, uppercased. `formatMoney()` hands this straight to Intl. */
function cleanCurrency(value: string): string {
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new ValidationError('A currency is a three-letter ISO code, like INR.');
  }
  return currency;
}
