import Link from 'next/link';
import { notFound } from 'next/navigation';
import { withTenant } from '@/db';
import { adminAccess, AdminDenied } from '../../guard';
import { can, findProperty } from '@/modules/identity';
import { getGuestDossier, DIETARY_FLAGS } from '@/modules/stay';
import { getRequestsForStay } from '@/modules/requests';
import { getFolioForStay, buildGuestStatement, PAYMENT_METHODS } from '@/modules/billing';
import { formatMoney, money, type CurrencyCode } from '@/lib/money';
import { formatCheckoutDay } from '@/lib/clock';
import { AdminShell } from '../../admin-shell';
import { GuestProfileForm } from './profile-form';
import { TakePaymentForm } from './payment-form';
import styles from '../../admin.module.css';

/**
 * One guest, everything this property knows.
 *
 * The room board answers the desk's minute-to-minute question — who is in 214
 * and what do they owe. This is the other one: the conversation that happens
 * when something has gone wrong, or when somebody who left yesterday rings about
 * a charge.
 *
 * ─── Two fields here are not decoration ────────────────────────────────────
 *
 * `chargingBlocked` refuses every charge to the room — `placeOrder()` has
 * honoured it since P1 and `raiseServiceRequest()` does as of this change.
 * `dietaryFlags` reaches the kitchen on every ticket the guest sends, which is
 * why "nut allergy" being editable from a screen and not only from a seeder
 * matters.
 *
 * `staffNotes` was written by nobody and read by nobody until this screen.
 */
export const dynamic = 'force-dynamic';

export default async function GuestPage({
  params,
}: {
  params: Promise<{ guestId: string }>;
}) {
  const { guestId } = await params;

  const access = await adminAccess('guest:read');
  if (!access.ok) return <AdminDenied reason={access.reason} />;
  const { session, propertyId } = access;

  const { property, guest, current } = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => {
      const found = await getGuestDossier(tx, { propertyId, guestId });
      if (!found) return { property: null, guest: null, current: null };
      return {
        property: await findProperty(tx, propertyId),
        guest: found,
        // Only for the stay they are on: history is the list below, and pulling
        // every order for every past stay is a screen nobody reads.
        current: found.currentStayId
          ? {
            folio: await getFolioForStay(tx, found.currentStayId),
            requests: await getRequestsForStay(tx, { stayId: found.currentStayId }),
          }
          : null,
      };
    },
  );

  if (!guest) notFound();

  const maySettle = can(session, propertyId, 'folio:settle');

  /**
   * Minted here, on the server, once per render — so a double-click posts the
   * same key twice and takes the money once (#8). The cart's send button has
   * done this since P1 for the same reason.
   */
  const paymentKey = crypto.randomUUID();

  const timeZone = property?.timezone ?? 'Asia/Kolkata';
  const statement = current
    ? buildGuestStatement(current.folio, { timeZone, currency: guest.currency })
    : null;

  return (
    <AdminShell
      session={session}
      propertyId={propertyId}
      propertyName={property?.name ?? 'This property'}
      current="rooms"
    >
      <header className={styles.pageHead}>
        <div>
          <h1 className={styles.title}>
            {guest.fullName}
            {guest.isVip ? <span className={styles.offTag}>VIP</span> : null}
          </h1>
          <p className={styles.lede}>
            {guest.phone ?? 'No phone on file'}
            {guest.email ? ` · ${guest.email}` : ''}
            {' · '}
            {guest.stays.length} {guest.stays.length === 1 ? 'stay' : 'stays'} here
            {guest.lifetimeChargesMinor > 0
              ? ` · ${formatMoney(money(guest.lifetimeChargesMinor, guest.currency))} spent`
              : ''}
            {guest.staysElsewhere > 0
              ? ` · ${guest.staysElsewhere} elsewhere in the group`
              : ''}
          </p>
        </div>
        <Link href="/admin/rooms" className={styles.secondary}>Rooms</Link>
      </header>

      {guest.chargingBlocked ? (
        <p className={styles.holdBanner} role="status">
          Charges to this room are on hold. Nothing they order or ask for will go
          on the folio until this is lifted — free requests still work.
        </p>
      ) : null}

      <section className={styles.section}>
        <header className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>What we know</h2>
          <p className={styles.sectionBlurb}>
            The allergies reach the kitchen on every ticket they send. The hold
            refuses every charge to the room.
          </p>
        </header>
        <GuestProfileForm
          propertyId={propertyId}
          guestId={guest.id}
          isVip={guest.isVip}
          chargingBlocked={guest.chargingBlocked}
          staffNotes={guest.staffNotes}
          dietaryFlags={[...guest.dietaryFlags]}
          allFlags={[...DIETARY_FLAGS]}
          mayEdit={can(session, propertyId, 'guest:update')}
        />
      </section>

      {statement ? (
        <section className={styles.section}>
          <header className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>On the room now</h2>
            <p className={styles.sectionBlurb}>
              The same bill the guest reads on their own phone.
            </p>
          </header>

          {statement.lines.length ? (
            <ul className={styles.dishes}>
              {statement.lines.map((line) => (
                <li key={line.id} className={styles.dish}>
                  <span className={styles.dishBody}>
                    <span className={styles.dishName}>{line.description}</span>
                    <span className={styles.dishFlags}>{line.date}</span>
                  </span>
                  <span className={`${styles.dishPrice} tabular`}>
                    {formatMoney(money(line.amountMinor, statement.currency as CurrencyCode))}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.sectionEmpty}>Nothing charged yet.</p>
          )}

          {statement.payments.length ? (
            <ul className={styles.dishes}>
              {statement.payments.map((payment) => (
                <li key={payment.id} className={styles.dish}>
                  <span className={styles.dishBody}>
                    <span className={styles.dishName}>{payment.description}</span>
                    <span className={styles.dishFlags}>{payment.date} · taken at the desk</span>
                  </span>
                  <span className={`${styles.paidAmount} tabular`}>
                    {formatMoney(money(
                      payment.amountMinor, statement.currency as CurrencyCode,
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          <p className={styles.folioTotalRow}>
            <span className={styles.folioTotalLabel}>{statement.totalLabel}</span>
            <span className={`${styles.folioTotalAmount} tabular`}>
              {formatMoney(money(
                Math.abs(statement.balanceMinor), statement.currency as CurrencyCode,
              ))}
            </span>
          </p>

          {/*
            * Only while there is something to take and somebody allowed to take
            * it. A settled bill offers no form — `recordPayment()` refuses one
            * anyway, and a control that always refuses is a control nobody
            * trusts.
            */}
          {maySettle && guest.currentStayId && !statement.settled ? (
            <TakePaymentForm
              propertyId={propertyId}
              stayId={guest.currentStayId}
              guestId={guest.id}
              idempotencyKey={paymentKey}
              methods={[...PAYMENT_METHODS]}
              suggestedAmount={
                statement.balanceMinor > 0
                  ? String(statement.balanceMinor / 100)
                  : ''
              }
              balanceLabel={
                statement.balanceMinor > 0
                  ? `${formatMoney(money(
                    statement.balanceMinor, statement.currency as CurrencyCode,
                  ))} on the room. Take it however they are paying, then check them out.`
                  : 'Nothing is owed. Recording a payment here would overpay the bill.'
              }
            />
          ) : null}
        </section>
      ) : null}

      {current?.requests.length ? (
        <section className={styles.section}>
          <header className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>What they have asked for</h2>
          </header>
          <ul className={styles.dishes}>
            {current.requests.map((request) => (
              <li key={request.id} className={styles.dish}>
                <span className={styles.dishBody}>
                  <span className={styles.dishName}>
                    {request.lines.map((line) => line.label).join(', ')}
                  </span>
                  <span className={styles.dishFlags}>
                    {request.requestNumber} · {request.status.toLowerCase().replace(/_/g, ' ')}
                    {request.guestNote ? ` · “${request.guestNote}”` : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={styles.section}>
        <header className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Stays</h2>
        </header>
        <ul className={styles.dishes}>
          {guest.stays.map((stay) => (
            <li key={stay.id} className={styles.dish} data-available={stay.status === 'CHECKED_IN'}>
              <span className={styles.dishBody}>
                <span className={styles.dishName}>Room {stay.roomNumber}</span>
                <span className={styles.dishFlags}>
                  {stay.status === 'CHECKED_IN'
                    ? `here now · out ${formatCheckoutDay(stay.scheduledCheckoutAt, timeZone)}`
                    : stay.checkedOutAt
                      ? `left ${formatCheckoutDay(stay.checkedOutAt, timeZone)}`
                      : stay.status.toLowerCase().replace(/_/g, ' ')}
                </span>
              </span>
              <span className={`${styles.dishPrice} tabular`}>
                {stay.balanceMinor === null
                  ? '—'
                  : formatMoney(money(stay.balanceMinor, stay.currency))}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <p className={styles.footnote}>
        This guest is one row for the whole group — matched on their phone number,
        so their history follows them between your hotels. What you write here is
        this property&rsquo;s own: a hold set in Udaipur is not a hold in Jaipur.
      </p>
    </AdminShell>
  );
}
