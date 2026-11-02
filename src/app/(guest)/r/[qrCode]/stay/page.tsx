import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, Phone } from 'lucide-react';
import { withTenant } from '@/db';
import {
  resolveStaySession, GUEST_SESSION_COOKIE, tierAtLeast, tierForAction,
} from '@/modules/access';
import {
  findProperty, describeRoom, getPropertyProfile, dialable, type GuestInfo,
} from '@/modules/identity';
import { getFolioForStay, buildGuestStatement } from '@/modules/billing';
import { getCheckoutOptions, checkoutCtaFor } from '@/modules/stay';
import { formatMoney, money, type CurrencyCode } from '@/lib/money';
import { formatCheckoutDay, formatClock, nightsUntil, spellCount } from '@/lib/clock';
import { VerifyForFolio } from './verify-form';
import { CheckoutOptions, PendingCheckout, CheckOutNow, type OfferView } from './checkout-options';
import { CopyValue } from './copy-value';
import styles from './stay.module.css';

/**
 * "Your stay" — when the guest is out, and what is on the room. Direction A's
 * `GuestStay` board, rebuilt with the real data.
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
 * The board draws the locked bill as "₹ ••,•••" and a Show button. Here the
 * masked figure is the same, and the button IS the four-digit form's submit —
 * the field sits in the card rather than behind a second tap, because a
 * button that only reveals another form is one more screen in the way.
 *
 * The tier is only READ here. Nothing is written while rendering, because the
 * room home links to this page and Next prefetches links in the viewport — see
 * the note in `actions.ts`, where the challenge is minted on submit instead.
 *
 * ─── Layout ────────────────────────────────────────────────────────────────
 *
 * The board's order: when they leave, with the late-checkout offers in the
 * same card; the bill; the hotel's own facts; a way to ring the desk. The
 * offers only appear to a guest through the prompt — `request_checkout` sits
 * on the same FULL tier as the folio (D-031), and drawing controls that would
 * refuse is worse than not drawing them.
 *
 * Left out of the board, on purpose: "WhatsApp us" (not approved), and the
 * breakfast and pool hours (no such data — the rows shown are the hotel's
 * own guest info). "Stay Thursday night" is not offered either: pricing a
 * NIGHT needs a rate plan for a room type on a date, which CLAUDE.md #11
 * forbids putting on a room and #12 reserves the names for (D-033).
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
    time: clockOf(offer.checkoutAt, timeZone),
    sub: offer.sub,
    price: offer.feeMinor === 0
      ? 'No charge'
      : formatMoney(money(offer.feeMinor, offer.currency as CurrencyCode)),
    free: offer.feeMinor === 0,
    cta: checkoutCtaFor(offer),
  }));

  const pendingView = describePending(leaving, timeZone);

  const nights = nightsUntil(new Date(), session.scheduledCheckoutAt, timeZone);
  const info = profile?.guestInfo ?? null;
  const phone = info?.contactPhone ? dialable(info.contactPhone).tel : null;

  return (
    <main className={styles.shell}>
      <header className={styles.bar}>
        <Link href={`${base}/home`} className={styles.back} aria-label="Back to room home">
          <ChevronLeft size={22} strokeWidth={1.5} aria-hidden="true" />
        </Link>
      </header>

      <div className={styles.body}>
        <h1 className={styles.title}>Your stay</h1>

        <section className={styles.card} aria-labelledby="checkout-heading">
          <div className={styles.checkoutHead}>
            <span className={styles.checkoutWhen}>
              <span id="checkout-heading" className={styles.eyebrow}>Checking out</span>
              <span className={styles.date}>
                {dayOf(session.scheduledCheckoutAt, timeZone)},{' '}
                <span className={`${styles.dateTime} tabular`}>
                  {clockOf(session.scheduledCheckoutAt, timeZone)}
                </span>
              </span>
            </span>
            <span className={styles.nights}>
              {nights === 0
                ? 'Today'
                : `${spellCount(nights)} ${nights === 1 ? 'night' : 'nights'} left`}
            </span>
          </div>

          <p className={styles.where}>
            Room {session.roomNumber}
            {room?.roomTypeName ? `, ${room.roomTypeName.toLowerCase()}` : ''}.
          </p>

          {verified && leaving ? (
            <div className={styles.leaving}>
              <h2 className={styles.eyebrow}>Leaving</h2>

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
                * back — recomputed against the checkout time they now have.
                */}
              {pendingView?.status === 'REQUESTED' ? null : offerViews.length ? (
                <CheckoutOptions qrCode={qrCode} offers={offerViews} />
              ) : (
                <p className={styles.quiet}>
                  Nothing more to add to today. The front desk can help if you need
                  longer.
                </p>
              )}

              <p className={styles.quiet}>
                Staying another night? The front desk arranges that one — the rate
                depends on the date.
              </p>

              {/* Not while something is waiting on the desk: "leave now" beside
                  "I have asked to stay until 6pm" is two answers to one question. */}
              {pendingView?.status === 'REQUESTED' ? null : <CheckOutNow qrCode={qrCode} />}
            </div>
          ) : null}
        </section>

        <section className={styles.card} aria-labelledby="folio-heading">
          <header className={styles.billHead}>
            <h2 id="folio-heading" className={styles.eyebrow}>Room folio</h2>
            <p className={styles.billMeta}>
              Room <span className="tabular">{session.roomNumber}</span>
              {verified ? ` · ${folio?.status === 'SETTLED' ? 'settled' : 'unsettled'}` : ''}
            </p>
          </header>

          {verified ? (
            <Statement folio={folio} timeZone={timeZone} currency={currency} />
          ) : (
            <>
              <p className={`${styles.masked} tabular`}>
                <span aria-hidden="true">₹ ••,•••</span>
                <span className="sr-only">Hidden until you answer below</span>
              </p>
              <VerifyForFolio qrCode={qrCode} roomNumber={session.roomNumber} />
            </>
          )}
        </section>

        {/* A room session holds the room, so it is shown the wifi password
            too — this is the card on the nightstand, on the phone. */}
        {info ? <TheHotel info={info} /> : null}
      </div>

      {/* Only when the hotel has given a number. Never an invented one. */}
      {phone ? (
        <div className={styles.foot}>
          <a href={`tel:${phone}`} className={styles.call}>
            <Phone size={18} strokeWidth={1.5} aria-hidden="true" />
            Call the desk
          </a>
        </div>
      ) : null}
    </main>
  );
}

/**
 * The board's "The hotel" rows, from the property's own guest info (D-087).
 * A row exists only when the hotel filled it in; with nothing filled in the
 * section is absent rather than a list of "not set".
 */
function TheHotel({ info }: { info: GuestInfo }) {
  const address = [info.addressLine, info.city].filter(Boolean).join(', ');
  const rows: { label: string; value: string; mono: boolean }[] = [
    ...(info.checkInTime ? [{ label: 'Check-in from', value: formatClock(info.checkInTime), mono: true }] : []),
    ...(info.checkOutTime ? [{ label: 'Check-out by', value: formatClock(info.checkOutTime), mono: true }] : []),
  ];
  if (!info.wifiNetwork && !rows.length && !info.contactEmail && !address) return null;

  return (
    <section className={styles.hotel} aria-labelledby="hotel-heading">
      <h2 id="hotel-heading" className={styles.eyebrow}>The hotel</h2>

      {info.wifiNetwork ? (
        <div className={styles.hotelRow} data-tall="true">
          <span className={styles.hotelStack}>
            <span className={styles.hotelLabel}>Wi-Fi · {info.wifiNetwork}</span>
            {info.wifiPassword ? (
              <span className={`${styles.wifiPassword} tabular`}>{info.wifiPassword}</span>
            ) : null}
          </span>
          {info.wifiPassword ? (
            <CopyValue value={info.wifiPassword} label="Copy the Wi-Fi password" />
          ) : null}
        </div>
      ) : null}

      {rows.map((row) => (
        <div key={row.label} className={styles.hotelRow}>
          <span>{row.label}</span>
          <span className={`${styles.hotelValue} tabular`}>{row.value}</span>
        </div>
      ))}

      {info.contactEmail ? (
        <div className={styles.hotelRow}>
          <span>Email</span>
          <a className={styles.hotelValue} href={`mailto:${info.contactEmail}`}>{info.contactEmail}</a>
        </div>
      ) : null}

      {address ? (
        <div className={styles.hotelRow}>
          <span>Address</span>
          <span className={styles.hotelValue}>{address}</span>
        </div>
      ) : null}
    </section>
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
      <p className={styles.total} data-settled={statement.settled}>
        <span className={styles.totalLabel}>{statement.totalLabel}</span>
        {statement.lines.length || statement.paidMinor ? (
          <span className={`${styles.totalAmount} tabular`}>
            {formatMoney(money(Math.abs(statement.balanceMinor), lineCurrency))}
          </span>
        ) : null}
      </p>

      {statement.lines.length ? (
        <ul className={styles.lines}>
          {statement.lines.map((line) => (
            <li key={line.id} className={styles.line} data-credit={line.isCredit}>
              <span className={`${styles.lineDate} tabular`}>{line.date}</span>
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
              <span className={`${styles.lineDate} tabular`}>{payment.date}</span>
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
          <span>Paid</span>
          <span className="tabular">
            {formatMoney(money(statement.paidMinor, lineCurrency))}
          </span>
        </p>
      ) : null}

      <p className={styles.note}>{statement.note}</p>
    </div>
  );
}

/** "Thu 5 Nov" — the board's date, on the property's calendar. */
function dayOf(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone,
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('weekday')} ${part('day')} ${part('month')}`;
}

/** "11am", "2:30pm" — on the property's clock, the board's way. */
function clockOf(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone,
  })
    .format(instant)
    .replace(/\s?([ap])\.?m\.?/i, (_, meridiem: string) => `${meridiem.toLowerCase()}m`)
    .replace(/:00(?=[ap]m)/i, '');
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
