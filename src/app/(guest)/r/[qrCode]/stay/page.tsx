import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { withTenant } from '@/db';
import {
  resolveGuestSession, GUEST_SESSION_COOKIE, tierAtLeast, tierForAction,
} from '@/modules/access';
import { findProperty, describeRoom } from '@/modules/identity';
import { getFolioForStay, buildGuestStatement } from '@/modules/billing';
import { formatMoney, money, type CurrencyCode } from '@/lib/money';
import { formatCheckoutDay, nightsUntil, spellCount } from '@/lib/clock';
import { VerifyForFolio } from './verify-form';
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
 * Its checkout options and "Check out now" are the NEXT task (P3 bullets 2–4,
 * `checkout_requests` is already in the schema) and are deliberately absent
 * rather than drawn as dead controls.
 */
export const dynamic = 'force-dynamic';

export default async function StayScreen({
  params,
}: {
  params: Promise<{ qrCode: string }>;
}) {
  const { qrCode } = await params;
  const store = await cookies();
  const session = await resolveGuestSession(store.get(GUEST_SESSION_COOKIE)?.value);

  if (!session) redirect(`/r/${encodeURIComponent(qrCode)}`);

  const base = `/r/${encodeURIComponent(qrCode)}`;
  const verified = tierAtLeast(session.accessTier, tierForAction('view_folio'));

  const { property, room, folio } = await withTenant(
    { tenantId: session.tenantId, propertyId: session.propertyId },
    async (tx) => ({
      property: await findProperty(tx, session.propertyId),
      room: await describeRoom(tx, {
        propertyId: session.propertyId, roomId: session.roomId,
      }),
      // Not read at all until the guest is through the prompt. A folio is not
      // fetched-then-hidden; it is not fetched.
      folio: verified ? await getFolioForStay(tx, session.stayId) : null,
    }),
  );

  const timeZone = property?.timezone ?? 'Asia/Kolkata';
  const currency = (property?.currency ?? 'INR') as CurrencyCode;

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
