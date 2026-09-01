import { withTenant } from '@/db';
import { adminAccess, AdminDenied } from '../guard';
import { can, findProperty } from '@/modules/identity';
import { listCheckoutRequests } from '@/modules/stay';
import { formatMoney, money, type CurrencyCode } from '@/lib/money';
import { formatCheckoutDay } from '@/lib/clock';
import { AdminShell } from '../admin-shell';
import { CheckoutQueue, type DeskRequestView } from './checkout-queue';
import styles from '../admin.module.css';

/**
 * Late checkouts waiting on the desk.
 *
 * A queue, not a feed: oldest first, and it empties. A guest who asked at 9am
 * for 2pm needs an answer well before 2pm, and the thing that makes that happen
 * is a screen with nothing else on it.
 *
 * Approving is not a note in a diary — it moves `stays.scheduled_checkout_at`,
 * posts the fee to the folio and pushes out every live session on the stay, all
 * in one transaction (`decideCheckoutRequest`). This screen is the only way to
 * do any of that.
 */
export const dynamic = 'force-dynamic';

export default async function CheckoutsAdmin() {
  const access = await adminAccess('stay:read');
  if (!access.ok) return <AdminDenied reason={access.reason} />;
  const { session, propertyId } = access;

  const { property, open, decided } = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => ({
      property: await findProperty(tx, propertyId),
      open: await listCheckoutRequests(tx, { propertyId, statuses: ['REQUESTED'] }),
      // Today's answers, so the desk can see what it just did — and so a guest
      // ringing down about a decline can be answered without a database query.
      decided: await listCheckoutRequests(tx, {
        propertyId, statuses: ['APPROVED', 'DECLINED'],
      }),
    }),
  );

  const timeZone = property?.timezone ?? 'Asia/Kolkata';

  const view = (rows: typeof open): DeskRequestView[] => rows.map((row) => {
    const fee = row.overriddenFeeMinor ?? row.feeMinor;
    return {
      id: row.id,
      roomNumber: row.roomNumber,
      guestName: row.guestName,
      status: row.status,
      wants: formatCheckoutDay(row.requestedCheckoutAt, timeZone),
      dueOut: formatCheckoutDay(row.scheduledCheckoutAt, timeZone),
      agreed: row.feeMinor === 0
        ? 'No charge'
        : formatMoney(money(row.feeMinor, row.currency as CurrencyCode)),
      // Only when it differs — "₹2,500 → ₹2,500" is noise on a busy desk.
      charged: row.overriddenFeeMinor !== null && row.overriddenFeeMinor !== row.feeMinor
        ? formatMoney(money(fee, row.currency as CurrencyCode))
        : null,
      isFree: row.feeMinor === 0,
      declineReason: row.declineReason,
    };
  });

  return (
    <AdminShell
      session={session}
      propertyId={propertyId}
      propertyName={property?.name ?? 'This property'}
      current="checkouts"
    >
      <header className={styles.pageHead}>
        <div>
          <h1 className={styles.title}>Leaving</h1>
          <p className={styles.lede}>
            {open.length === 0
              ? 'Nothing waiting.'
              : `${open.length} waiting on an answer.`}
          </p>
        </div>
      </header>

      <CheckoutQueue
        propertyId={propertyId}
        open={view(open)}
        decided={view(decided)}
        mayDecide={can(session, propertyId, 'checkout_request:approve')}
        mayOverride={can(session, propertyId, 'checkout_request:override_fee')}
      />

      <p className={styles.footnote}>
        Approving moves the guest&rsquo;s checkout, puts the fee on their folio and
        keeps their phone working until the new time — all at once, so none of the
        three can be true without the others. Declining charges nothing: the fee
        is only ever posted on a yes.
      </p>
    </AdminShell>
  );
}
