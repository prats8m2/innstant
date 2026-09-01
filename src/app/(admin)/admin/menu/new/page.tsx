import { notFound } from 'next/navigation';
import { withTenant } from '@/db';
import { adminAccess, AdminDenied } from '../../guard';
import { findProperty } from '@/modules/identity';
import {
  getInRoomDiningOutlet, getAdminMenu, listModifierGroups, MENU_DIETARY_FLAGS,
} from '@/modules/catalog';
import { AdminShell } from '../../admin-shell';
import { DishForm } from '../dish-form';
import styles from '../../admin.module.css';

/** A new dish. Optionally pre-filled with the section it was added from. */
export const dynamic = 'force-dynamic';

export default async function NewDish({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  // Creating a dish sets a price, so both permissions are required to even see
  // the form. The action re-checks; this only avoids offering a dead end.
  const access = await adminAccess('catalog:manage', 'catalog:pricing');
  if (!access.ok) return <AdminDenied reason={access.reason} />;
  const { session, propertyId } = access;

  const { property, outlet, menu, groups } = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => {
      const found = await getInRoomDiningOutlet(tx, propertyId);
      return {
        property: await findProperty(tx, propertyId),
        outlet: found,
        menu: found ? await getAdminMenu(tx, { outletId: found.id }) : null,
        groups: found ? await listModifierGroups(tx, { outletId: found.id }) : [],
      };
    },
  );

  if (!outlet || !menu) notFound();

  return (
    <AdminShell
      session={session}
      propertyName={property?.name ?? 'This property'}
      current="menu"
    >
      <h1 className={styles.title}>A new dish</h1>
      <p className={styles.lede}>On {menu.outlet.name}.</p>

      <DishForm
        propertyId={propertyId}
        outletId={menu.outlet.id}
        currency={menu.outlet.currency}
        categories={menu.categories}
        modifierGroups={groups}
        dietaryFlags={MENU_DIETARY_FLAGS}
        defaultCategoryId={category}
      />
    </AdminShell>
  );
}
