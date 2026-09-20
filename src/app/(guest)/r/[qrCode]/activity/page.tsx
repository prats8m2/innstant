import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { withTenant } from '@/db';
import { resolveGuestSession, GUEST_SESSION_COOKIE } from '@/modules/access';
import { findProperty } from '@/modules/identity';
import { listOrdersForStay, orderStateFor, OPEN_TO_A_GUEST } from '@/modules/ordering';
import {
  getRequestsForStay, requestStateFor, REQUEST_OPEN_TO_A_GUEST,
} from '@/modules/requests';
import { formatMoney, money } from '@/lib/money';
import { formatFolioDate } from '@/lib/clock';
import { LiveActivity } from './live-activity';
import styles from './activity.module.css';

/**
 * Everything this room has asked for — food and amenities, in one list.
 *
 * ─── Why the two are one screen ────────────────────────────────────────────
 *
 * This started as an orders list, and amenities had the identical gap: a guest
 * who asked for towels and pressed back had no way to reach the request again,
 * and no way to see what they had asked for on Tuesday. The obvious fix was a
 * second screen — and it would have been the wrong one.
 *
 * A guest does not hold "orders" and "service requests" as separate ideas. That
 * split is ours: two modules, two tables, two state machines, two SLA clocks.
 * What they have is one question — "what did I ask for, and where is it" — and
 * the answer is one list, newest first, with the kind of thing named on each
 * row rather than in a tab they have to choose between first.
 *
 * Each row still links to the screen that already tracks it: the order timeline
 * or the request's own page. This is the way back in, not a replacement.
 *
 * ─── What is NOT gated ─────────────────────────────────────────────────────
 *
 * CLAUDE.md #9: browsing is never behind verification. The one prompt is at the
 * first attempt to CHARGE, which already happened for anything here that costs.
 * The session is bound to the stay (#10), so this list is the room's by
 * construction — a request from next door is not reachable from it.
 */
export const dynamic = 'force-dynamic';

/** One row, whichever module it came from. */
interface Entry {
  id: string;
  href: string;
  kind: 'Order' | 'Amenity';
  label: string;
  tone: 'open' | 'done' | 'stopped';
  summary: string;
  /** Null when nothing was charged — not the same as zero (#5). */
  amount: string | null;
  at: Date | null;
  reference: string;
  live: boolean;
  /** The kitchen's or the desk's own words, when something was refused. */
  haltReason: string | null;
  /** "12 min left", "over by 4 min" — requests only; orders have a timeline. */
  promise: string | null;
  promiseLate: boolean;
}

export default async function ActivityScreen({
  params,
}: {
  params: Promise<{ qrCode: string }>;
}) {
  const { qrCode } = await params;
  const store = await cookies();
  const session = await resolveGuestSession(store.get(GUEST_SESSION_COOKIE)?.value);

  if (!session) redirect(`/r/${encodeURIComponent(qrCode)}`);

  const base = `/r/${encodeURIComponent(qrCode)}`;

  const { property, orders, requests } = await withTenant(
    { tenantId: session.tenantId, propertyId: session.propertyId },
    async (tx) => ({
      property: await findProperty(tx, session.propertyId),
      orders: await listOrdersForStay(tx, { stayId: session.stayId }),
      requests: await getRequestsForStay(tx, { stayId: session.stayId }),
    }),
  );

  const timeZone = property?.timezone ?? 'Asia/Kolkata';

  const entries: Entry[] = [
    ...orders.map((order): Entry => {
      const state = orderStateFor(order.status);
      return {
        id: order.id,
        href: `${base}/order/${order.id}`,
        kind: 'Order',
        label: state.label,
        tone: state.tone,
        summary: order.summary,
        amount: formatMoney(money(order.totalMinor, order.currency)),
        at: order.placedAt,
        reference: order.orderNumber,
        live: OPEN_TO_A_GUEST.includes(order.status),
        haltReason: order.haltReason,
        promise: null,
        promiseLate: false,
      };
    }),
    ...requests.map((request): Entry => {
      const state = requestStateFor(request.status);
      const live = REQUEST_OPEN_TO_A_GUEST.includes(request.status);
      return {
        id: request.id,
        href: `${base}/service/${request.id}`,
        kind: 'Amenity',
        label: state.label,
        tone: state.tone,
        // The things asked for, in the guest's own words from the amenity list.
        summary: request.lines
          .map((line) => (line.quantity > 1 ? `${line.quantity}× ${line.label}` : line.label))
          .join(' · '),
        /**
         * Free requests show no amount at all rather than "₹0". Most amenities
         * are free, and a column of zeroes down a list reads as a bill.
         */
        amount: request.totalMinor > 0
          ? formatMoney(money(request.totalMinor, request.currency))
          : null,
        at: request.createdAt,
        reference: request.requestNumber,
        live,
        haltReason: request.rejectionReason ?? request.cancellationReason ?? null,
        // The promise only means something while it is still being kept.
        promise: live ? describeSla(request.breached, request.secondsRemaining) : null,
        promiseLate: request.breached,
      };
    }),
  ].sort(byNewest);

  const live = entries.filter((entry) => entry.live);
  const past = entries.filter((entry) => !entry.live);

  return (
    <main className={styles.shell}>
      <header className={styles.bar}>
        <Link href={`${base}/home`} className={styles.back} aria-label="Back to room home">
          ←
        </Link>
        <h1 className={styles.barTitle}>Your requests</h1>
      </header>

      {/* Only while something is moving. A history page that holds a stream
          open all night for things that finished on Tuesday is a battery cost
          with nothing to show for it. */}
      {live.length ? <LiveActivity propertyId={session.propertyId} /> : null}

      {entries.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Nothing asked for yet</p>
          <p className={styles.emptyBody}>
            Anything you order from the kitchen or ask housekeeping for shows up
            here, with how far along it is.
          </p>
          <Link href={`${base}/menu`} className={styles.emptyCta}>See the menu</Link>
        </div>
      ) : null}

      {live.length ? (
        <section className={styles.group}>
          <h2 className={styles.groupHeading}>Happening now</h2>
          <ul className={styles.list}>
            {live.map((entry) => (
              <Row key={entry.id} entry={entry} timeZone={timeZone} />
            ))}
          </ul>
        </section>
      ) : null}

      {past.length ? (
        <section className={styles.group}>
          <h2 className={styles.groupHeading}>Earlier in this stay</h2>
          <ul className={styles.list}>
            {past.map((entry) => (
              <Row key={entry.id} entry={entry} timeZone={timeZone} />
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}

/**
 * One row.
 *
 * A link, always — even a refused one. The screen behind it carries the words
 * the kitchen or the desk actually used, and somebody whose request was refused
 * is the person most likely to want to read them again.
 */
function Row({ entry, timeZone }: { entry: Entry; timeZone: string }) {
  return (
    <li>
      <Link href={entry.href} className={styles.row} data-live={entry.live}>
        <span className={styles.rowHead}>
          <span className={styles.state} data-tone={entry.tone}>
            {entry.live ? <span className={styles.pulse} aria-hidden="true" /> : null}
            {entry.label}
          </span>
          {entry.amount ? (
            <span className={`${styles.total} tabular`}>{entry.amount}</span>
          ) : null}
        </span>

        <span className={styles.summary}>{entry.summary}</span>

        <span className={styles.meta}>
          <span className={`${styles.when} tabular`}>
            {/* The kind, said on the row. A guest scanning a mixed list should
                not have to work out which of these was dinner. */}
            {entry.kind} · {entry.at ? formatFolioDate(entry.at, timeZone) : '—'}
          </span>
          {entry.promise ? (
            <span className={`${styles.promise} tabular`} data-late={entry.promiseLate}>
              {entry.promise}
            </span>
          ) : (
            <span className={`${styles.number} tabular`}>{entry.reference}</span>
          )}
        </span>

        {entry.haltReason ? (
          <span className={styles.reason}>“{entry.haltReason}”</span>
        ) : null}
      </Link>
    </li>
  );
}

/**
 * Newest first, across both kinds.
 *
 * An order with no `placed_at` cannot reach this list (`listOrdersForStay`
 * excludes DRAFT), and a request always has `created_at` — so the null arm is
 * belt and braces rather than a real case, and it sorts last rather than
 * throwing the whole list into an arbitrary order.
 */
function byNewest(a: Entry, b: Entry): number {
  const at = a.at ? new Date(a.at).getTime() : 0;
  const bt = b.at ? new Date(b.at).getTime() : 0;
  return bt - at;
}

/**
 * The promise, from the request's own countdown.
 *
 * `secondsRemaining` is computed against the clock by the read, never stored —
 * a breach is a function of time, not a column.
 */
function describeSla(breached: boolean, secondsRemaining: number | null): string | null {
  if (secondsRemaining === null) return null;
  const minutes = Math.max(0, Math.round(Math.abs(secondsRemaining) / 60));
  return breached ? `over by ${minutes} min` : `${minutes} min left`;
}
