import Link from 'next/link';
import { withTenant } from '@/db';
import { getInRoomDiningOutlet, listModifierGroupsForAdmin } from '@/modules/catalog';
import { adminAccess, AdminDenied } from '../../guard';
import { OptionEditor } from './option-editor';
import styles from '../../admin.module.css';

/**
 * Option groups — the choices a guest gets on a dish, and what they cost.
 *
 * Its own screen rather than a panel on the dish form, because a group is
 * SHARED: "Chilli" is one row carried by seven dishes, and editing it from
 * inside one dish would hide that. The dish form attaches groups; this one
 * defines them.
 */
export const dynamic = 'force-dynamic';

export default async function OptionsAdmin() {
  // A price delta is a price.
  const access = await adminAccess('catalog:manage', 'catalog:pricing');
  if (!access.ok) return <AdminDenied reason={access.reason} />;
  const { session, propertyId } = access;

  const { outlet, groups } = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => {
      const found = await getInRoomDiningOutlet(tx, propertyId);
      return {
        outlet: found,
        groups: found ? await listModifierGroupsForAdmin(tx, { outletId: found.id }) : [],
      };
    },
  );

  if (!outlet) {
    return (
      <>
        <h1 className={styles.title}>Option groups</h1>
        <p className={styles.empty}>No in-room dining outlet is configured here.</p>
      </>
    );
  }

  const shared = groups.filter((g) => g.dishCount > 1).length;

  return (
    <>
      <header className={styles.pageHead}>
        <div>
          <h1 className={styles.title}>Option groups</h1>
          <p className={styles.lede}>
            {groups.length} {groups.length === 1 ? 'group' : 'groups'}
            {shared ? `, ${shared} shared across more than one dish` : ''}. Attach
            them to dishes from the dish form.
          </p>
        </div>
        <Link href="/admin/menu" className={styles.secondary}>Back to the menu</Link>
      </header>

      <OptionEditor propertyId={propertyId} outletId={outlet.id} groups={groups} />
    </>
  );
}
