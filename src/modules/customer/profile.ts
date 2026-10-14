import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { recordEvent, type Tx } from '@/db';
import { guestAddresses } from '@/db/schema/customer';
import { NotFoundError, ValidationError } from '@/lib/errors';

/**
 * What a customer can see and change about themselves. D-081.
 *
 * ─── The name a customer sets is NOT the name on their folio ───────────────
 *
 * `guests.full_name` belongs to the front desk. It is what a folio is made out
 * to and what `/admin/guests/[guestId]` renders, and `upsertGuestByPhone()`
 * already refuses to overwrite it — "a guest called 'Anjali Menon' on her
 * folio who types 'anj' into a takeaway form has not renamed herself".
 *
 * A customer-facing update writing that column would break the same invariant
 * for the one caller that has proved a phone number and nothing else. A
 * recycled number would rename a real guest's record. So the customer writes
 * `display_name`, reads resolve `COALESCE(display_name, full_name)`, and the
 * desk's copy is never touched.
 */

export interface CustomerProfile {
  guestId: string;
  /** COALESCE(display_name, full_name) — what the customer calls themselves. */
  name: string;
  phone: string | null;
  email: string | null;
  phoneVerified: boolean;
}

/**
 * Raw SQL for the `guests` read: that is `modules/stay`'s table and D-001
 * forbids importing it here. A read-only projection inside the tenant-scoped
 * transaction is the exception this codebase already makes, and RLS applies to
 * every row it touches.
 */
export async function getProfile(tx: Tx, guestId: string): Promise<CustomerProfile | null> {
  const rows = await tx.execute<{
    id: string; name: string; phone: string | null;
    email: string | null; phone_verified_at: Date | null;
  }>(sql`
    SELECT id, COALESCE(display_name, full_name) AS name, phone, email, phone_verified_at
    FROM guests WHERE id = ${guestId} LIMIT 1
  `);

  const row = rows.rows[0];
  if (!row) return null;
  return {
    guestId: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    phoneVerified: Boolean(row.phone_verified_at),
  };
}

export async function updateProfile(
  tx: Tx,
  input: { tenantId: string; guestId: string; name?: string; email?: string | null },
): Promise<CustomerProfile> {
  const name = input.name?.trim();
  if (name !== undefined) {
    if (name.length < 2) throw new ValidationError('We need a name for your orders.');
    if (name.length > 80) throw new ValidationError('That name is too long for a ticket.');
  }

  const email = input.email?.trim() || null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new ValidationError('That email address does not look right.');
  }

  // `display_name`, never `full_name`. See the note at the top of this file.
  await tx.execute(sql`
    UPDATE guests
       SET display_name = COALESCE(${name ?? null}, display_name),
           email        = COALESCE(${email}, email),
           updated_at   = now()
     WHERE id = ${input.guestId}
  `);

  await recordEvent(tx, {
    tenantId: input.tenantId,
    entityType: 'guest',
    entityId: input.guestId,
    eventType: 'customer.profile_updated',
    actor: { kind: 'CUSTOMER', guestId: input.guestId },
    payload: { changed: [name !== undefined && 'name', email && 'email'].filter(Boolean) },
  });

  const profile = await getProfile(tx, input.guestId);
  if (!profile) throw new NotFoundError('That account is no longer available.');
  return profile;
}

/* ── Addresses ───────────────────────────────────────────────────────────── */

export interface CustomerAddress {
  id: string;
  label: string;
  line: string;
  notes: string | null;
  isDefault: boolean;
}

export async function listAddresses(tx: Tx, guestId: string): Promise<CustomerAddress[]> {
  return tx.select({
    id: guestAddresses.id,
    label: guestAddresses.label,
    line: guestAddresses.line,
    notes: guestAddresses.notes,
    isDefault: guestAddresses.isDefault,
  }).from(guestAddresses)
    .where(and(eq(guestAddresses.guestId, guestId), isNull(guestAddresses.archivedAt)))
    // The default first, then oldest — a stable order, so the picker does not
    // reshuffle between renders.
    .orderBy(asc(guestAddresses.isDefault), asc(guestAddresses.createdAt));
}

export interface AddressInput {
  tenantId: string;
  guestId: string;
  label: string;
  line: string;
  notes?: string | null;
  isDefault?: boolean;
}

function validate(input: Pick<AddressInput, 'label' | 'line' | 'notes'>): void {
  if (!input.label.trim()) throw new ValidationError('Give the address a name — Home, Work.');
  if (input.label.trim().length > 40) throw new ValidationError('That name is too long.');
  if (!input.line.trim()) throw new ValidationError('An address needs somewhere to go to.');
  if (input.line.trim().length > 400) {
    throw new ValidationError('That address is longer than a ticket can print. Shorten it.');
  }
  if ((input.notes?.trim().length ?? 0) > 280) {
    throw new ValidationError('Keep the note for the rider shorter.');
  }
}

/**
 * The first address a customer saves becomes their default whether they asked
 * or not. Somebody with exactly one address and no default is a checkout
 * screen with nothing preselected, which is a worse answer than guessing.
 */
export async function createAddress(tx: Tx, input: AddressInput): Promise<CustomerAddress> {
  validate(input);

  const existing = await listAddresses(tx, input.guestId);
  const isDefault = input.isDefault || existing.length === 0;

  if (isDefault) await clearDefault(tx, input.guestId);

  const [row] = await tx.insert(guestAddresses).values({
    tenantId: input.tenantId,
    guestId: input.guestId,
    label: input.label.trim(),
    line: input.line.trim(),
    notes: input.notes?.trim() || null,
    isDefault,
  }).returning({ id: guestAddresses.id });

  return {
    id: row!.id,
    label: input.label.trim(),
    line: input.line.trim(),
    notes: input.notes?.trim() || null,
    isDefault,
  };
}

/**
 * Every statement here is scoped by `guest_id` as well as `id`.
 *
 * RLS confines these rows to the TENANT, and an address id travels in a URL —
 * so without the second predicate one customer could edit another's address
 * inside the same hotel group. The same discipline `getOrderForContext` states
 * and for the same reason. A miss is a 404, never a 403.
 */
export async function updateAddress(
  tx: Tx,
  input: AddressInput & { addressId: string },
): Promise<CustomerAddress> {
  validate(input);

  if (input.isDefault) await clearDefault(tx, input.guestId);

  const updated = await tx.update(guestAddresses)
    .set({
      label: input.label.trim(),
      line: input.line.trim(),
      notes: input.notes?.trim() || null,
      ...(input.isDefault === undefined ? {} : { isDefault: input.isDefault }),
      updatedAt: new Date(),
    })
    .where(and(
      eq(guestAddresses.id, input.addressId),
      eq(guestAddresses.guestId, input.guestId),
      isNull(guestAddresses.archivedAt),
    ))
    .returning({ id: guestAddresses.id, isDefault: guestAddresses.isDefault });

  if (!updated[0]) throw new NotFoundError('That address is no longer saved.');

  return {
    id: updated[0].id,
    label: input.label.trim(),
    line: input.line.trim(),
    notes: input.notes?.trim() || null,
    isDefault: updated[0].isDefault,
  };
}

/** Archived, not deleted — an order that went there keeps its own snapshot
 *  (#6), and nothing that pointed at this row breaks. */
export async function archiveAddress(
  tx: Tx,
  input: { guestId: string; addressId: string },
): Promise<void> {
  const archived = await tx.update(guestAddresses)
    .set({ archivedAt: new Date(), isDefault: false, updatedAt: new Date() })
    .where(and(
      eq(guestAddresses.id, input.addressId),
      eq(guestAddresses.guestId, input.guestId),
      isNull(guestAddresses.archivedAt),
    ))
    .returning({ id: guestAddresses.id });

  if (!archived[0]) throw new NotFoundError('That address is no longer saved.');
}

/** At most one default among the live ones — the partial unique index in 0009
 *  enforces it, and this is what keeps the next write legal. */
async function clearDefault(tx: Tx, guestId: string): Promise<void> {
  await tx.update(guestAddresses)
    .set({ isDefault: false })
    .where(and(
      eq(guestAddresses.guestId, guestId),
      eq(guestAddresses.isDefault, true),
      isNull(guestAddresses.archivedAt),
    ));
}
