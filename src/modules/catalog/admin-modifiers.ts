import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { recordEvent, type Tx } from '@/db';
import {
  modifierGroups, modifierOptions, menuItemModifierGroups, menuItems, outlets,
} from '@/db/schema/catalog';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import type { CurrencyCode } from '@/lib/money';

/**
 * Modifier groups and their options — the choices a guest gets on a dish.
 *
 * The last part of the catalog that only the seeder could write. Four groups
 * are seeded for The Kesari ("Chilli" is one row shared by seven dishes); a
 * second property would have got none.
 *
 * ─── Why this is a money path ──────────────────────────────────────────────
 *
 * `modifier_options.price_delta_minor` is signed and it is added to the line
 * total (`lineTotal` in ordering/totals.ts). Editing an option's delta changes
 * what a dish costs, so everything here needs `catalog:pricing` as well as
 * `catalog:manage` — the same rule as a dish price, for the same reason.
 *
 * Past orders are safe regardless: `order_item_modifiers` snapshots the name
 * AND the delta it charged (#6), so renaming "Extra fiery" or repricing it
 * cannot alter a receipt.
 *
 * ─── Reuse is the point ────────────────────────────────────────────────────
 *
 * A group is attached to dishes through `menu_item_modifier_groups`, so editing
 * one group changes every dish carrying it. That is why it is a group and not a
 * per-dish list — and why archiving one is an explicit two-step below rather
 * than something that quietly changes seven dishes.
 */

export interface AdminModifierOption {
  id: string;
  name: string;
  priceDeltaMinor: number;
  currency: CurrencyCode;
  isDefault: boolean;
  isAvailable: boolean;
  sortOrder: number;
}

export interface AdminModifierGroupDetail {
  id: string;
  name: string;
  minSelections: number;
  maxSelections: number;
  isRequired: boolean;
  sortOrder: number;
  options: AdminModifierOption[];
  /** How many dishes carry this group. The reason to be careful with it. */
  dishCount: number;
}

export async function listModifierGroupsForAdmin(
  tx: Tx,
  input: { outletId: string },
): Promise<AdminModifierGroupDetail[]> {
  const groups = await tx.select({
    id: modifierGroups.id,
    name: modifierGroups.name,
    minSelections: modifierGroups.minSelections,
    maxSelections: modifierGroups.maxSelections,
    isRequired: modifierGroups.isRequired,
    sortOrder: modifierGroups.sortOrder,
  }).from(modifierGroups)
    .where(and(
      eq(modifierGroups.outletId, input.outletId),
      isNull(modifierGroups.archivedAt),
    ))
    .orderBy(asc(modifierGroups.sortOrder), asc(modifierGroups.name));

  if (!groups.length) return [];

  const options = await tx.select({
    id: modifierOptions.id,
    groupId: modifierOptions.groupId,
    name: modifierOptions.name,
    priceDeltaMinor: modifierOptions.priceDeltaMinor,
    currency: modifierOptions.currency,
    isDefault: modifierOptions.isDefault,
    isAvailable: modifierOptions.isAvailable,
    sortOrder: modifierOptions.sortOrder,
  }).from(modifierOptions)
    .where(isNull(modifierOptions.archivedAt))
    .orderBy(asc(modifierOptions.sortOrder), asc(modifierOptions.name));

  // One count query for every group, not one per group.
  const usage = await tx.select({
    groupId: menuItemModifierGroups.modifierGroupId,
    n: count(),
  }).from(menuItemModifierGroups)
    .innerJoin(menuItems, eq(menuItems.id, menuItemModifierGroups.menuItemId))
    .where(isNull(menuItems.archivedAt))
    .groupBy(menuItemModifierGroups.modifierGroupId);

  return groups.map((group) => ({
    ...group,
    options: options
      .filter((o) => o.groupId === group.id)
      .map(({ groupId: _groupId, currency, ...rest }) => ({
        ...rest,
        currency: currency as CurrencyCode,
      })),
    dishCount: Number(usage.find((u) => u.groupId === group.id)?.n ?? 0),
  }));
}

/* ── Groups ─────────────────────────────────────────────────────────────── */

export interface ModifierGroupWriteInput {
  tenantId: string;
  propertyId: string;
  outletId: string;
  name: string;
  minSelections: number;
  maxSelections: number;
  isRequired: boolean;
  actorStaffId: string;
}

export async function createModifierGroup(
  tx: Tx,
  input: ModifierGroupWriteInput,
): Promise<{ id: string }> {
  const name = requireGroupName(input.name);
  validateSelections(input);

  const outlet = await tx.select({ id: outlets.id }).from(outlets)
    .where(and(eq(outlets.id, input.outletId), isNull(outlets.archivedAt))).limit(1);
  if (!outlet[0]) throw new NotFoundError('No such outlet at this property.');

  const [row] = await tx.insert(modifierGroups).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    outletId: input.outletId,
    name,
    minSelections: input.minSelections,
    maxSelections: input.maxSelections,
    isRequired: input.isRequired,
    sortOrder: await nextGroupSort(tx, input.outletId),
  }).returning({ id: modifierGroups.id });

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'modifier_group',
    entityId: row!.id,
    eventType: 'modifier_group.created',
    actor: { kind: 'STAFF', staffUserId: input.actorStaffId },
    payload: { name },
  });

  return { id: row!.id };
}

export async function updateModifierGroup(
  tx: Tx,
  input: ModifierGroupWriteInput & { groupId: string },
): Promise<void> {
  const name = requireGroupName(input.name);
  validateSelections(input);

  const group = await tx.select({ id: modifierGroups.id }).from(modifierGroups)
    .where(and(
      eq(modifierGroups.id, input.groupId),
      eq(modifierGroups.outletId, input.outletId),
      isNull(modifierGroups.archivedAt),
    ))
    .limit(1);
  if (!group[0]) throw new NotFoundError('That option group is not on this menu.');

  // Narrowing a group to one choice while several options are marked default
  // would leave a dish preselecting two mutually exclusive things.
  if (input.maxSelections === 1) {
    const defaults = await tx.select({ n: count() }).from(modifierOptions)
      .where(and(
        eq(modifierOptions.groupId, input.groupId),
        eq(modifierOptions.isDefault, true),
        isNull(modifierOptions.archivedAt),
      ));
    if (Number(defaults[0]?.n ?? 0) > 1) {
      throw new ConflictError(
        'This group has more than one option ticked as the default. '
        + 'Leave one before limiting it to a single choice.',
      );
    }
  }

  await tx.update(modifierGroups)
    .set({
      name,
      minSelections: input.minSelections,
      maxSelections: input.maxSelections,
      isRequired: input.isRequired,
      updatedAt: new Date(),
    })
    .where(eq(modifierGroups.id, input.groupId));

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'modifier_group',
    entityId: input.groupId,
    eventType: 'modifier_group.updated',
    actor: { kind: 'STAFF', staffUserId: input.actorStaffId },
    payload: {
      name,
      minSelections: input.minSelections,
      maxSelections: input.maxSelections,
      isRequired: input.isRequired,
    },
  });
}

/**
 * Archive a group.
 *
 * Refuses while dishes carry it, unless `detachFromDishes` is set — and then it
 * says how many it came off. Archiving a shared group silently would change
 * seven dishes' pricing options from a screen showing one row, which is exactly
 * the kind of edit nobody remembers making.
 *
 * The join rows are deleted rather than archived: they carry no history worth
 * keeping (`order_item_modifiers` snapshots what was actually charged, #6), and
 * a stale one would resurrect the group if it were ever un-archived.
 */
export async function archiveModifierGroup(
  tx: Tx,
  input: {
    tenantId: string; propertyId: string; outletId: string;
    groupId: string; detachFromDishes?: boolean; actorStaffId: string;
  },
): Promise<{ name: string; detachedFrom: number }> {
  const attached = await tx.select({ n: count() })
    .from(menuItemModifierGroups)
    .innerJoin(menuItems, eq(menuItems.id, menuItemModifierGroups.menuItemId))
    .where(and(
      eq(menuItemModifierGroups.modifierGroupId, input.groupId),
      isNull(menuItems.archivedAt),
    ));

  const dishCount = Number(attached[0]?.n ?? 0);
  if (dishCount > 0 && !input.detachFromDishes) {
    throw new ConflictError(
      `${dishCount} ${dishCount === 1 ? 'dish carries' : 'dishes carry'} this group. `
      + 'Archiving it changes what those dishes offer.',
    );
  }

  const archived = await tx.update(modifierGroups)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(modifierGroups.id, input.groupId),
      eq(modifierGroups.outletId, input.outletId),
      isNull(modifierGroups.archivedAt),
    ))
    .returning({ id: modifierGroups.id, name: modifierGroups.name });

  const group = archived[0];
  if (!group) throw new NotFoundError('That option group is not on this menu.');

  if (dishCount > 0) {
    await tx.delete(menuItemModifierGroups)
      .where(eq(menuItemModifierGroups.modifierGroupId, input.groupId));
  }

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'modifier_group',
    entityId: group.id,
    eventType: 'modifier_group.archived',
    actor: { kind: 'STAFF', staffUserId: input.actorStaffId },
    payload: { name: group.name, detachedFrom: dishCount },
  });

  return { name: group.name, detachedFrom: dishCount };
}

/* ── Options ────────────────────────────────────────────────────────────── */

export interface ModifierOptionWriteInput {
  tenantId: string;
  propertyId: string;
  outletId: string;
  groupId: string;
  name: string;
  /** Signed: a modifier may reduce the price. Minor units (#5). */
  priceDeltaMinor: number;
  currency: CurrencyCode;
  isDefault: boolean;
  isAvailable: boolean;
  actorStaffId: string;
}

export async function createModifierOption(
  tx: Tx,
  input: ModifierOptionWriteInput,
): Promise<{ id: string }> {
  const name = requireGroupName(input.name);
  const group = await requireGroup(tx, input);

  if (input.isDefault && group.maxSelections === 1) {
    await clearDefaults(tx, input.groupId);
  }

  const [row] = await tx.insert(modifierOptions).values({
    tenantId: input.tenantId,
    groupId: input.groupId,
    name,
    priceDeltaMinor: input.priceDeltaMinor,
    currency: input.currency,
    isDefault: input.isDefault,
    isAvailable: input.isAvailable,
    sortOrder: await nextOptionSort(tx, input.groupId),
  }).returning({ id: modifierOptions.id });

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'modifier_group',
    entityId: input.groupId,
    eventType: 'modifier_option.created',
    actor: { kind: 'STAFF', staffUserId: input.actorStaffId },
    payload: {
      optionId: row!.id,
      name,
      priceDeltaMinor: input.priceDeltaMinor,
      currency: input.currency,
    },
  });

  return { id: row!.id };
}

/**
 * Update an option.
 *
 * A changed price delta gets its own event with both numbers, for the same
 * reason a dish reprice does: "the extras cost more than the menu said" is
 * settled by what the delta was on the night.
 */
export async function updateModifierOption(
  tx: Tx,
  input: ModifierOptionWriteInput & { optionId: string },
): Promise<void> {
  const name = requireGroupName(input.name);
  const group = await requireGroup(tx, input);

  const existing = await tx.select({
    priceDeltaMinor: modifierOptions.priceDeltaMinor,
  }).from(modifierOptions)
    .where(and(
      eq(modifierOptions.id, input.optionId),
      eq(modifierOptions.groupId, input.groupId),
      isNull(modifierOptions.archivedAt),
    ))
    .limit(1);

  const before = existing[0];
  if (!before) throw new NotFoundError('That option is not in this group.');

  if (input.isDefault && group.maxSelections === 1) {
    await clearDefaults(tx, input.groupId, input.optionId);
  }

  await tx.update(modifierOptions)
    .set({
      name,
      priceDeltaMinor: input.priceDeltaMinor,
      currency: input.currency,
      isDefault: input.isDefault,
      isAvailable: input.isAvailable,
      updatedAt: new Date(),
    })
    .where(eq(modifierOptions.id, input.optionId));

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'modifier_group',
    entityId: input.groupId,
    eventType: 'modifier_option.updated',
    actor: { kind: 'STAFF', staffUserId: input.actorStaffId },
    payload: { optionId: input.optionId, name },
  });

  if (before.priceDeltaMinor !== input.priceDeltaMinor) {
    await recordEvent(tx, {
      tenantId: input.tenantId,
      propertyId: input.propertyId,
      entityType: 'modifier_group',
      entityId: input.groupId,
      eventType: 'modifier_option.repriced',
      actor: { kind: 'STAFF', staffUserId: input.actorStaffId },
      payload: {
        optionId: input.optionId,
        name,
        fromMinor: before.priceDeltaMinor,
        toMinor: input.priceDeltaMinor,
        currency: input.currency,
      },
    });
  }
}

/**
 * D-008 — archived, never deleted.
 *
 * Refuses to archive the last option in a group a dish carries: `getDish()`
 * joins options INNER, so a group with none simply vanishes from the dish, and
 * a REQUIRED group vanishing means the dish silently loses a choice the kitchen
 * needs. Better to say so than to have it disappear.
 */
export async function archiveModifierOption(
  tx: Tx,
  input: {
    tenantId: string; propertyId: string; outletId: string;
    groupId: string; optionId: string; actorStaffId: string;
  },
): Promise<{ name: string }> {
  await requireGroup(tx, input);

  const remaining = await tx.select({ n: count() }).from(modifierOptions)
    .where(and(
      eq(modifierOptions.groupId, input.groupId),
      isNull(modifierOptions.archivedAt),
    ));

  if (Number(remaining[0]?.n ?? 0) <= 1) {
    throw new ConflictError(
      'A group needs at least one option — archive the whole group instead.',
    );
  }

  const archived = await tx.update(modifierOptions)
    .set({ archivedAt: new Date(), isAvailable: false, updatedAt: new Date() })
    .where(and(
      eq(modifierOptions.id, input.optionId),
      eq(modifierOptions.groupId, input.groupId),
      isNull(modifierOptions.archivedAt),
    ))
    .returning({ id: modifierOptions.id, name: modifierOptions.name });

  const option = archived[0];
  if (!option) throw new NotFoundError('That option is not in this group.');

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'modifier_group',
    entityId: input.groupId,
    eventType: 'modifier_option.archived',
    actor: { kind: 'STAFF', staffUserId: input.actorStaffId },
    payload: { optionId: option.id, name: option.name },
  });

  return { name: option.name };
}

/* ── Guards ─────────────────────────────────────────────────────────────── */

function requireGroupName(raw: string): string {
  const name = raw.trim();
  if (!name) throw new ValidationError('Give it a name the guest will understand.');
  if (name.length > 120) throw new ValidationError('That name is too long for a menu.');
  return name;
}

function validateSelections(input: {
  minSelections: number;
  maxSelections: number;
  isRequired: boolean;
}): void {
  const { minSelections, maxSelections, isRequired } = input;

  for (const [label, value] of [['minimum', minSelections], ['maximum', maxSelections]] as const) {
    if (!Number.isInteger(value) || value < 0 || value > 20) {
      throw new ValidationError(`The ${label} must be a whole number, 0 to 20.`);
    }
  }
  if (maxSelections < 1) {
    throw new ValidationError('A group a guest cannot choose from is not a group.');
  }
  if (minSelections > maxSelections) {
    throw new ValidationError('The minimum cannot be more than the maximum.');
  }
  // A required group with a minimum of zero is satisfied by choosing nothing,
  // which is the same as not being required — and the guest screen would draw a
  // "required" badge over a group they can skip.
  if (isRequired && minSelections < 1) {
    throw new ValidationError('A required group needs a minimum of at least one.');
  }
}

async function requireGroup(
  tx: Tx,
  input: { outletId: string; groupId: string },
): Promise<{ maxSelections: number }> {
  const rows = await tx.select({ maxSelections: modifierGroups.maxSelections })
    .from(modifierGroups)
    .where(and(
      eq(modifierGroups.id, input.groupId),
      eq(modifierGroups.outletId, input.outletId),
      isNull(modifierGroups.archivedAt),
    ))
    .limit(1);

  const group = rows[0];
  if (!group) throw new NotFoundError('That option group is not on this menu.');
  return group;
}

/** One default in a single-choice group: the last one set wins. */
async function clearDefaults(tx: Tx, groupId: string, except?: string): Promise<void> {
  await tx.update(modifierOptions)
    .set({ isDefault: false })
    .where(and(
      eq(modifierOptions.groupId, groupId),
      eq(modifierOptions.isDefault, true),
      ...(except ? [sql`${modifierOptions.id} <> ${except}`] : []),
    ));
}

async function nextGroupSort(tx: Tx, outletId: string): Promise<number> {
  const rows = await tx.execute<{ next: number }>(sql`
    SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
    FROM modifier_groups WHERE outlet_id = ${outletId} AND archived_at IS NULL
  `);
  return Number(rows.rows[0]?.next ?? 0);
}

async function nextOptionSort(tx: Tx, groupId: string): Promise<number> {
  const rows = await tx.execute<{ next: number }>(sql`
    SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
    FROM modifier_options WHERE group_id = ${groupId} AND archived_at IS NULL
  `);
  return Number(rows.rows[0]?.next ?? 0);
}
