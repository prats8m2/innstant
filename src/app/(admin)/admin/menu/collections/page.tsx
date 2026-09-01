import Link from 'next/link';
import { withTenant } from '@/db';
import { findProperty } from '@/modules/identity';
import {
  getInRoomDiningOutlet, getAdminMenu, listCollections, isWithinWindow,
} from '@/modules/catalog';
import { localTimeAt } from '@/lib/clock';
import { adminAccess, AdminDenied } from '../../guard';
import { AdminShell } from '../../admin-shell';
import { CollectionEditor } from './collection-editor';
import styles from '../../admin.module.css';

/**
 * Collections — how the menu reads.
 *
 * The guest's menu leads with these and falls back to categories, so this is
 * the screen that decides what a guest sees first and in what voice. It is also
 * the last piece of the catalog that was editable only by the seeder.
 */
export const dynamic = 'force-dynamic';

export default async function CollectionsAdmin() {
  const access = await adminAccess('catalog:manage');
  if (!access.ok) return <AdminDenied reason={access.reason} />;
  const { session, propertyId } = access;

  const { property, menu, collections, at } = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => {
      const found = await findProperty(tx, propertyId);
      const outlet = await getInRoomDiningOutlet(tx, propertyId);
      return {
        property: found,
        menu: outlet ? await getAdminMenu(tx, { outletId: outlet.id }) : null,
        collections: outlet ? await listCollections(tx, { outletId: outlet.id }) : [],
        at: localTimeAt(new Date(), found?.timezone ?? 'Asia/Kolkata'),
      };
    },
  );

  const propertyName = property?.name ?? 'This property';

  if (!menu) {
    return (
      <AdminShell session={session} propertyId={propertyId} propertyName={propertyName} current="menu">
        <h1 className={styles.title}>Collections</h1>
        <p className={styles.empty}>No in-room dining outlet is configured here.</p>
      </AdminShell>
    );
  }

  // The same check the guest read makes, on the same rows, at the property's
  // own clock — so "showing now" on this screen means showing now on a phone.
  const showingNow = collections
    .filter((c) => c.isActive
      && c.items.length > 0
      && isWithinWindow(c.availableFrom, c.availableUntil, at))
    .map((c) => c.id);

  return (
    <AdminShell session={session} propertyId={propertyId} propertyName={propertyName} current="menu">
      <header className={styles.pageHead}>
        <div>
          <h1 className={styles.title}>Collections</h1>
          <p className={styles.lede}>
            The guest&rsquo;s menu leads with these, in this order, and falls back to
            sections for anything not in one. {showingNow.length} of{' '}
            {collections.length} {collections.length === 1 ? 'is' : 'are'} showing
            right now.
          </p>
        </div>
        <Link href="/admin/menu" className={styles.secondary}>Back to the menu</Link>
      </header>

      <CollectionEditor
        propertyId={propertyId}
        outletId={menu.outlet.id}
        collections={collections}
        categories={menu.categories}
        showingNow={showingNow}
      />
    </AdminShell>
  );
}
