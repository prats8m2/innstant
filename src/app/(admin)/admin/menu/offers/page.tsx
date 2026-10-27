import Link from 'next/link';
import { withTenant } from '@/db';
import { findProperty } from '@/modules/identity';
import {
  getInRoomDiningOutlet, getAdminMenu, listOffers, scheduleState, describeSchedule, offerLabel,
} from '@/modules/catalog';
import { localTimeAt } from '@/lib/clock';
import { adminAccess, AdminDenied } from '../../guard';
import { scheduleLabel } from '../schedule-label';
import { OfferEditor, type OfferStatus } from './offer-editor';
import styles from '../../admin.module.css';

/**
 * Offers (D-085): money off the menu, automatically, on a schedule.
 *
 * Behind `catalog:pricing`, because an offer is a price. The status of each
 * is the same rule the guest's menu and the cart price with
 * (isCollectionLive, through bestOffer), at the hotel's own clock, so
 * "showing now" here is the price on a guest's phone this minute.
 */
export const dynamic = 'force-dynamic';

export default async function OffersAdmin() {
  const access = await adminAccess('catalog:pricing');
  if (!access.ok) return <AdminDenied reason={access.reason} />;
  const { session, propertyId } = access;

  const { property, menu, offers } = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => {
      const outlet = await getInRoomDiningOutlet(tx, propertyId);
      return {
        property: await findProperty(tx, propertyId),
        menu: outlet ? await getAdminMenu(tx, { outletId: outlet.id }) : null,
        offers: outlet ? await listOffers(tx, { outletId: outlet.id }) : [],
      };
    },
  );
  if (!menu) {
    return (
      <>
        <h1 className={styles.title}>Offers</h1>
        <p className={styles.empty}>No in-room dining outlet is configured here.</p>
      </>
    );
  }

  const now = localTimeAt(new Date(), property?.timezone ?? 'Asia/Kolkata');
  const statuses: Record<string, OfferStatus> = Object.fromEntries(offers.map((o) => {
    const state = scheduleState(o, now);
    return [o.id, {
      label: scheduleLabel(state).label,
      live: o.isActive && state.kind === 'live',
      schedule: describeSchedule(o, now.date),
      amount: offerLabel(o),
      target: o.scope === 'MENU'
        ? 'Whole menu'
        : o.scope === 'CATEGORY' ? `Section: ${o.targetName ?? 'archived'}` : (o.targetName ?? 'an archived dish'),
    }];
  }));
  const live = Object.values(statuses).filter((s) => s.live).length;

  return (
    <>
      <header className={styles.pageHead}>
        <div>
          <h1 className={styles.title}>Offers</h1>
          <p className={styles.lede}>
            Money off, by itself, while an offer is live: no codes for anyone to
            type. {live} of {offers.length} {offers.length === 1 ? 'is' : 'are'} live right now.
          </p>
        </div>
        <Link href="/admin/menu" className={styles.secondary}>Back to the menu</Link>
      </header>

      <OfferEditor
        propertyId={propertyId}
        outletId={menu.outlet.id}
        offers={offers}
        statuses={statuses}
        categories={menu.categories}
        today={now.date!}
      />
    </>
  );
}
