import { notFound } from 'next/navigation';
import { z } from 'zod';
import { withTenant, readEventHistory } from '@/db';
import { adminAccess, AdminDenied } from '../../guard';
import {
  getInRoomDiningOutlet, getAdminMenu, getAdminMenuItem, listModifierGroups,
  MENU_DIETARY_FLAGS,
} from '@/modules/catalog';
import { formatMoney, money } from '@/lib/money';
import { DishForm } from '../dish-form';
import { DishHistory } from '../dish-history';
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
  // Not an id at all is a 404, not a uuid cast failing inside the query.
  if (!z.uuid().safeParse(itemId).success) notFound();
  const access = await adminAccess('catalog:manage', 'catalog:pricing');
  if (!access.ok) return <AdminDenied reason={access.reason} />;
  const { session, propertyId } = access;

  const { menu, item, groups, history } = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => {
      const outlet = await getInRoomDiningOutlet(tx, propertyId);
      if (!outlet) {
        return { menu: null, item: null, groups: [], history: [] };
      }
      return {
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
    <>
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

      <DishHistory events={history} />
    </>
  );
}
