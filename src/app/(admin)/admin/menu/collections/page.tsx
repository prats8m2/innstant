import Link from 'next/link';
import { withTenant } from '@/db';
import { findProperty } from '@/modules/identity';
import {
  getInRoomDiningOutlet, getAdminMenu, listCollections, scheduleState, describeSchedule,
} from '@/modules/catalog';
import { localTimeAt } from '@/lib/clock';
import { adminAccess, AdminDenied } from '../../guard';
import { CollectionEditor } from './collection-editor';
import { scheduleLabel } from '../schedule-label';
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

  const { menu, collections, at } = await withTenant(
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

  if (!menu) {
    return (
      <>
        <h1 className={styles.title}>Collections</h1>
        <p className={styles.empty}>No in-room dining outlet is configured here.</p>
      </>
    );
  }

  // The same rule the guest read applies (isCollectionLive, D-084), on the
  // same rows, at the property's own clock: "showing now" on this screen
  // means showing now on a phone, and anything else says why not.
  const statuses = Object.fromEntries(collections.map((c) => {
    const state = scheduleState(c, at);
    return [c.id, {
      label: scheduleLabel(state).label,
      schedule: describeSchedule(c, at.date),
      live: state.kind === 'live',
    }];
  }));
  const showingNow = collections.filter((c) =>
    c.isActive && c.items.length > 0 && statuses[c.id]!.live).length;

  return (
    <>
      <header className={styles.pageHead}>
        <div>
          <h1 className={styles.title}>Collections</h1>
          <p className={styles.lede}>
            The guest&rsquo;s menu leads with these, in this order, and falls back to
            sections for anything not in one. {showingNow} of{' '}
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
        statuses={statuses}
        today={at.date!}
      />
    </>
  );
}
