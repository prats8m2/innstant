import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { withTenant } from '@/db';
import {
  resolveStaySession, GUEST_SESSION_COOKIE, tierAtLeast, tierForAction,
} from '@/modules/access';
import { findProperty, describeRoom, getPropertyProfile } from '@/modules/identity';
import { HotelInfo } from '../../../_brand/hotel-info';
import { getFolioForStay, buildGuestStatement } from '@/modules/billing';
import { getCheckoutOptions, checkoutCtaFor } from '@/modules/stay';
import { formatMoney, money, type CurrencyCode } from '@/lib/money';
import { formatCheckoutDay, nightsUntil, spellCount } from '@/lib/clock';
import { VerifyForFolio } from './verify-form';
import { CheckoutOptions, PendingCheckout, CheckOutNow, type OfferView } from './checkout-options';
import styles from './stay.module.css';

/**
 * "Your stay" — when the guest is out, and what is on the room.
 *
 * P3's first screen, and the biggest hole in the product until now:
 * `getFolioForStay()` has been written and tested since P0 while every charge
 * path posted into a folio no guest could see. A hotel whose guests cannot check
 * their own bill has not replaced the printout under the door.
 *
 * ─── The one prompt lives here ─────────────────────────────────────────────
 *
 * `view_folio` needs the FULL tier (`tiers.ts`) and a bare scan grants REQUEST,
 * so an unverified guest gets the four-digit question before the bill. That is
 * NOT a contradiction of #9: #9 protects browsing — menus, prices, POIs and
 * free service calls — and a folio is none of those. It is the one screen on
 * the guest surface where the content is personal, and a QR sticker is
 * photographable from a corridor.
 *
 * The tier is only READ here. Nothing is written while rendering, because the
 * room home links to this page and Next prefetches links in the viewport — see
 * the note in `actions.ts`, where the challenge is minted on submit instead.
 *
 * ─── Layout ────────────────────────────────────────────────────────────────
 *
 * The reference's `stay` screen, rebuilt with real components: the eyebrow, the
 * Marcellus date, the folio rule and the saffron total are all its measurements.
 * Its checkout options and "Check out now" are here too, below the folio rather
 * than above it: the reference draws them first, and a guest who has just been
 * asked to verify should meet the thing they came for before an upsell.
 *
 * One option the reference has and this does not: "Stay Thursday night". Pricing
 * a NIGHT needs a nightly rate — a rate plan for a room type on a date — which
 * CLAUDE.md #11 forbids putting on a room and #12 reserves the names for. Late
 * checkout is a service fee the property sets; another night is a booking
 * (D-033), and the line under the options says where to go for one.
 */
export const dynamic = 'force-dynamic';

export default async function StayScreen({
  params,
}: {
  params: Promise<{ qrCode: string }>;
}) {
  const { qrCode } = await params;
  const store = await cookies();
  const session = await resolveStaySession(store.get(GUEST_SESSION_COOKIE)?.value);

  if (!session) redirect(`/r/${encodeURIComponent(qrCode)}`);

  const base = `/r/${encodeURIComponent(qrCode)}`;
  const verified = tierAtLeast(session.accessTier, tierForAction('view_folio'));

  const { property, profile, room, folio, leaving } = await withTenant(
    { tenantId: session.tenantId, propertyId: session.propertyId },
    async (tx) => {
      const found = await findProperty(tx, session.propertyId);
      const zone = found?.timezone ?? 'Asia/Kolkata';
      return {
        property: found,
        // D-087: the wifi, the desk's number, the standard times. Needs no
        // verification — it is what the desk would tell anyone in the room.
        profile: await getPropertyProfile(tx, session.propertyId),
        room: await describeRoom(tx, {
          propertyId: session.propertyId, roomId: session.roomId,
        }),
        // Neither of these is read until the guest is through the prompt. A
        // folio is not fetched-then-hidden; it is not fetched.
        folio: verified ? await getFolioForStay(tx, session.stayId) : null,
        leaving: verified
          ? await getCheckoutOptions(tx, {
            propertyId: session.propertyId, stayId: session.stayId, timeZone: zone,
          })
          : null,
      };
    },
  );

  const timeZone = property?.timezone ?? 'Asia/Kolkata';
  const currency = (property?.currency ?? 'INR') as CurrencyCode;

  /**
   * The money is formatted HERE and handed over as a string. A client component
   * importing `formatMoney` from a module index would be fine, but importing the
   * offers themselves would not — and keeping every amount formatted on the
   * server is what makes #5 one rule in one place rather than a convention the
   * next component may not follow.
   */
  const offerViews: OfferView[] = (leaving?.offers ?? []).map((offer) => ({
    id: offer.id,
    title: offer.title,
    sub: offer.sub,
    price: offer.feeMinor === 0
      ? 'No charge'
      : formatMoney(money(offer.feeMinor, offer.currency as CurrencyCode)),
    cta: checkoutCtaFor(offer),
  }));

  const pendingView = describePending(leaving, timeZone);

  const checkout = formatCheckoutDay(session.scheduledCheckoutAt, timeZone);
  const nights = nightsUntil(new Date(), session.scheduledCheckoutAt, timeZone);

  return (
    <main className={styles.shell}>
      <header className={styles.bar}>
        <Link href={`${base}/home`} className={styles.back} aria-label="Back to room home">
          ←
        </Link>
        <h1 className={styles.barTitle}>Your stay</h1>
      </header>

      <div className={styles.body}>
        <p className={styles.eyebrow}>Checking out</p>
        <p className={styles.when}>{checkout}</p>
        <p className={styles.where}>
          {nights === 0
            ? 'Today.'
            : `${spellCount(nights)} ${nights === 1 ? 'night' : 'nights'} left.`}
          {' '}
          Room {session.roomNumber}
          {room?.roomTypeName ? `, ${room.roomTypeName.toLowerCase()}` : ''}.
        </p>

        <section className={styles.folio} aria-labelledby="folio-heading">
          <header className={styles.folioHead}>
            <h2 id="folio-heading" className={styles.folioTitle}>Room folio</h2>
            <p className={styles.folioMeta}>
              Room {session.roomNumber}
              {verified ? ` · ${folio?.status === 'SETTLED' ? 'settled' : 'unsettled'}` : ''}
            </p>
          </header>

          {verified ? (
            <Statement
              folio={folio}
              timeZone={timeZone}
              currency={currency}
            />
          ) : (
            <VerifyForFolio qrCode={qrCode} roomNumber={session.roomNumber} />
          )}
        </section>

        {/* Only for a guest who is through the prompt: `request_checkout` sits
            on the same FULL tier as the folio (D-031), and drawing controls
            that would refuse is worse than not drawing them. */}
        {verified && leaving ? (
          <section className={styles.leaving} aria-labelledby="leaving-heading">
            <h2 id="leaving-heading" className={styles.leavingTitle}>Leaving</h2>

            {pendingView ? (
              <PendingCheckout
                qrCode={qrCode}
                requestId={pendingView.id}
                status={pendingView.status}
                headline={pendingView.headline}
                detail={pendingView.detail}
                canWithdraw={pendingView.canWithdraw}
              />
            ) : null}

            {/*
              * While a request is OPEN the options are gone: a guest who asked
              * for 2pm and can still see a 6pm button will press it, and the
              * one-open-request index would refuse in a way that reads as a bug.
              *
              * Once it is decided the slot is free again, so the options come
              * back — recomputed against the checkout time they now have. A
              * guest who moved to 2pm can go on to ask for 6pm, and one whose
              * request was declined can ask for something else.
              */}
            {pendingView?.status === 'REQUESTED' ? null : offerViews.length ? (
              <CheckoutOptions qrCode={qrCode} offers={offerViews} />
            ) : (
              <p className={styles.noOffers}>
                Nothing more to add to today. The front desk can help if you need
                longer.
              </p>
            )}

            <p className={styles.anotherNight}>
              Staying another night? The front desk arranges that one — the rate
              depends on the date.
            </p>

            {/* Not while something is waiting on the desk: "leave now" beside
                "I have asked to stay until 6pm" is two answers to one question. */}
            {pendingView?.status === 'REQUESTED' ? null : <CheckOutNow qrCode={qrCode} />}
          </section>
        ) : null}

        {/* A room session holds the room, so it is shown the wifi password
            too — this is the card on the nightstand, on the phone. */}
        {profile ? <HotelInfo info={profile.guestInfo} showWifiPassword /> : null}
      </div>
    </main>
  );
}

function Statement({
  folio,
  timeZone,
  currency,
}: {
  folio: Awaited<ReturnType<typeof getFolioForStay>>;
  timeZone: string;
  currency: CurrencyCode;
}) {
  const statement = buildGuestStatement(folio, { timeZone, currency });
  const lineCurrency = statement.currency as CurrencyCode;

  return (
    <div className={styles.ledger}>
      {statement.lines.length ? (
        <ul className={styles.lines}>
          {statement.lines.map((line) => (
            <li key={line.id} className={styles.line} data-credit={line.isCredit}>
              <span className={styles.lineDate}>{line.date}</span>
              <span className={styles.lineWhat}>{line.description}</span>
              <span className={`${styles.lineAmount} tabular`}>
                {formatMoney(money(line.amountMinor, lineCurrency))}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {/*
        * How they paid, listed. "Paid ₹450" alone is missing the half of a bill
        * a guest actually checks — that the right card was charged.
        */}
      {statement.payments.length ? (
        <ul className={styles.lines}>
          {statement.payments.map((payment) => (
            <li key={payment.id} className={styles.line} data-payment="true">
              <span className={styles.lineDate}>{payment.date}</span>
              <span className={styles.lineWhat}>{payment.description}</span>
              <span className={`${styles.lineAmount} tabular`}>
                {formatMoney(money(payment.amountMinor, lineCurrency))}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {statement.paidMinor !== 0 ? (
        <p className={styles.paid}>
          <span className={styles.paidLabel}>Paid</span>
          <span className={`${styles.paidAmount} tabular`}>
            {formatMoney(money(statement.paidMinor, lineCurrency))}
          </span>
        </p>
      ) : null}

      <p className={styles.total} data-settled={statement.settled}>
        <span className={styles.totalLabel}>{statement.totalLabel}</span>
        {statement.lines.length || statement.paidMinor ? (
          <span className={`${styles.totalAmount} tabular`}>
            {formatMoney(money(Math.abs(statement.balanceMinor), lineCurrency))}
          </span>
        ) : null}
      </p>

      <p className={styles.note}>{statement.note}</p>
    </div>
  );
}

/**
 * What a request that has already been made says on the guest's screen.
 *
 * Only the states a guest can still be looking at. CANCELLED and COMPLETED are
 * absent on purpose: a withdrawn request should give the options back rather
 * than leave a receipt for something that did not happen, and a completed stay
 * is not reading this screen.
 */
function describePending(
  leaving: Awaited<ReturnType<typeof getCheckoutOptions>> | null,
  timeZone: string,
): {
  id: string; status: string; headline: string; detail: string; canWithdraw: boolean;
} | null {
  const pending = leaving?.pending;
  if (!pending) return null;

  const at = formatCheckoutDay(pending.requestedCheckoutAt, timeZone);
  const fee = pending.overriddenFeeMinor ?? pending.feeMinor;
  const amount = formatMoney(money(fee, pending.currency));

  if (pending.status === 'REQUESTED') {
    return {
      id: pending.id,
      status: pending.status,
      headline: fee > 0 ? `Asked for ${at}` : 'You told us you are leaving',
      detail: fee > 0
        // The promise that makes the wait bearable, and it is true: the fee is
        // posted on approval, never on the ask.
        ? `${amount} if the desk says yes. Nothing is charged until they do.`
        : 'Someone will come up for the key.',
      canWithdraw: true,
    };
  }

  if (pending.status === 'APPROVED') {
    return {
      id: pending.id,
      status: pending.status,
      headline: `Checkout moved to ${at}`,
      detail: fee > 0 ? `${amount} is on the room.` : 'Nothing to pay for it.',
      canWithdraw: false,
    };
  }

  if (pending.status === 'DECLINED') {
    return {
      id: pending.id,
      status: pending.status,
      headline: 'The desk could not do that one',
      // Their words, verbatim — the same rule the kitchen's rejection follows.
      detail: pending.declineReason ?? 'Ask at the desk and they will explain.',
      canWithdraw: false,
    };
  }

  return null;
}
