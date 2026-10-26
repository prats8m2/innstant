import { notFound } from 'next/navigation';
import { withTenant, readEventHistory } from '@/db';
import { adminAccess, AdminDenied } from '../../guard';
import { findProperty } from '@/modules/identity';
import {
  getInRoomDiningOutlet, getAdminMenu, getAdminMenuItem, listModifierGroups,
  MENU_DIETARY_FLAGS,
} from '@/modules/catalog';
import { formatMoney, money } from '@/lib/money';
import { AdminShell } from '../../admin-shell';
import { DishForm } from '../dish-form';
import styles from '../../admin.module.css';

/**
 * One dish, editable — and its history underneath.
 *
 * The history is the point of writing an `event_log` row for every catalog edit:
 * "who repriced this, and when" is answerable on the screen where it matters,
 * without anyone opening a database console.
 */
export const dynamic = 'force-dynamic';

export default async function EditDish({
  params,
}: {
  params: Promise<{ itemId: string }>;
}) {
  const { itemId } = await params;
  const access = await adminAccess('catalog:manage', 'catalog:pricing');
  if (!access.ok) return <AdminDenied reason={access.reason} />;
  const { session, propertyId } = access;

  const { property, menu, item, groups, history } = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => {
      const outlet = await getInRoomDiningOutlet(tx, propertyId);
      if (!outlet) {
        return { property: null, menu: null, item: null, groups: [], history: [] };
      }
      return {
        property: await findProperty(tx, propertyId),
        menu: await getAdminMenu(tx, { outletId: outlet.id }),
        item: await getAdminMenuItem(tx, { outletId: outlet.id, itemId }),
        groups: await listModifierGroups(tx, { outletId: outlet.id }),
        history: await readEventHistory(tx, 'menu_item', itemId),
      };
    },
  );

  // An id from a sister property's outlet is a 404, not an edit form.
  if (!menu || !item) notFound();

  return (
    <AdminShell
      session={session}
      propertyId={propertyId}
      propertyName={property?.name ?? 'This property'}
      current="menu"
    >
      <h1 className={styles.title}>{item.name}</h1>
      <p className={styles.lede}>
        On {menu.outlet.name}, at {formatMoney(money(item.priceMinor, item.currency))}.
      </p>

      <DishForm
        propertyId={propertyId}
        outletId={menu.outlet.id}
        currency={menu.outlet.currency}
        categories={menu.categories}
        modifierGroups={groups}
        dietaryFlags={MENU_DIETARY_FLAGS}
        item={item}
      />

      {history.length ? (
        <section className={styles.history}>
          <h2 className={styles.historyTitle}>What has happened to it</h2>
          <ol className={styles.historyList}>
            {history.slice().reverse().map((event, i) => (
              <li key={`${event.occurred_at as string}-${i}`} className={styles.historyRow}>
                <span className={`${styles.historyWhen} tabular`}>
                  {new Date(event.occurred_at as string).toISOString().slice(0, 16).replace('T', ' ')}
                </span>
                <span className={styles.historyWhat}>
                  {describe(event)}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </AdminShell>
  );
}

/**
 * The log, in words.
 *
 * Only the event types this module writes — anything unrecognised prints its raw
 * type rather than being swallowed, because a silently dropped audit row is
 * worse than an ugly one.
 */
function describe(event: Record<string, unknown>): string {
  const type = String(event.event_type);
  const payload = (event.payload ?? {}) as Record<string, unknown>;

  if (type === 'menu_item.repriced') {
    const from = Number(payload.fromMinor);
    const to = Number(payload.toMinor);
    const currency = (payload.currency as 'INR') ?? 'INR';
    return `Repriced from ${formatMoney(money(from, currency))} to ${formatMoney(money(to, currency))}`;
  }

  // Dragged into another section on the menu studio's board.
  if (type === 'menu_item.moved') {
    return payload.from && payload.to
      ? `Moved from ${String(payload.from)} to ${String(payload.to)}`
      : 'Moved to another section';
  }

  return {
    'menu_item.created': 'Added to the menu',
    'menu_item.updated': 'Edited',
    'menu_item.available': 'Put back on',
    'menu_item.unavailable': 'Taken off for the night',
    'menu_item.archived': 'Taken off the menu',
  }[type] ?? type;
}
