import { withTenant } from '@/db';
import { adminAccess, AdminDenied } from '../guard';
import { findProperty } from '@/modules/identity';
import {
  getInRoomDiningOutlet, getOutletSettings, outletOpenState, describeOpenState,
} from '@/modules/catalog';
import { localTimeAt, formatClock } from '@/lib/clock';
import { AdminShell } from '../admin-shell';
import { OutletSettingsForm, OutletHoursForm } from './outlet-forms';
import styles from '../admin.module.css';

/**
 * The outlet: what it charges, and when it is open.
 *
 * `outlet_hours` has been written by provisioning since S6 and read by nothing
 * — both guest screens carried the literal "Kitchen open until 11:30pm" while
 * the seeded rows said 07:00–01:00. This screen is the other half of fixing
 * that: the hours are now editable AND the guest reads them.
 */
export const dynamic = 'force-dynamic';

export default async function OutletAdmin() {
  // Both permissions to see the form at all: a tax rate is a price, and the
  // KITCHEN role holds neither. The actions re-check regardless.
  const access = await adminAccess('catalog:manage', 'catalog:pricing');
  if (!access.ok) return <AdminDenied reason={access.reason} />;
  const { session, propertyId } = access;

  const { property, outlet } = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => {
      const found = await getInRoomDiningOutlet(tx, propertyId);
      return {
        property: await findProperty(tx, propertyId),
        outlet: found ? await getOutletSettings(tx, { propertyId, outletId: found.id }) : null,
      };
    },
  );

  const propertyName = property?.name ?? 'This property';

  if (!outlet) {
    return (
      <AdminShell session={session} propertyName={propertyName} current="outlet">
        <h1 className={styles.title}>The kitchen</h1>
        <p className={styles.empty}>No in-room dining outlet is configured here.</p>
      </AdminShell>
    );
  }

  // Exactly what a guest would read right now, on the same logic they get.
  const timeZone = property?.timezone ?? 'Asia/Kolkata';
  const guestLine = describeOpenState(
    outletOpenState(outlet.hours, localTimeAt(new Date(), timeZone)),
    formatClock,
  );

  return (
    <AdminShell session={session} propertyName={propertyName} current="outlet">
      <h1 className={styles.title}>The kitchen</h1>
      <p className={styles.lede}>
        A guest looking at the menu right now reads: <strong>{guestLine}</strong>
      </p>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>What it charges</h2>
        <OutletSettingsForm propertyId={propertyId} outlet={outlet} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>When it is open</h2>
        <OutletHoursForm propertyId={propertyId} outlet={outlet} />
      </section>

      <p className={styles.footnote}>
        Changing a rate does not touch an order already placed: every line
        snapshots the price it charged and the totals are stored on the order
        itself. Tonight&rsquo;s receipts stay tonight&rsquo;s receipts.
      </p>
    </AdminShell>
  );
}
