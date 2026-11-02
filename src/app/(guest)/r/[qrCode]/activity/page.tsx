import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { withTenant } from '@/db';
import { resolveStaySession, GUEST_SESSION_COOKIE } from '@/modules/access';
import { findProperty } from '@/modules/identity';
import {
  listOrdersForContext, orderStateFor, OPEN_TO_A_GUEST, contextForSession,
  trackProgress, trackEta,
} from '@/modules/ordering';
import {
  getRequestsForStay, requestStateFor, REQUEST_OPEN_TO_A_GUEST, type RequestStatus,
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
 * ─── Direction A ───────────────────────────────────────────────────────────
 *
 * No board of its own; it speaks the tracking board's language. A live row is
 * a card carrying the same dots as the timeline it opens onto — ready for a
 * step behind it, the accent for the one happening, an outline for what is to
 * come — and its promise in mono, or how far behind it is in the soft late
 * tone, in words. Finished rows are hairline rows below.
 *
 * No `loading.tsx` beside this file, on purpose (D-099).
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
  /** "by 9:17pm", "about 4 min behind" — only while the promise is in play. */
  promise: string | null;
  promiseLate: boolean;
  /** Where it is on its own timeline, 1-based; null when it is not on one. */
  progress: { index: number; of: number } | null;
}

/** A request's four steps, as its tracking screen draws them. */
const REQUEST_STEP: Record<RequestStatus, number> = {
  OPEN: 1, ASSIGNED: 2, IN_PROGRESS: 3, COMPLETED: 4, VERIFIED: 4, REJECTED: 0, CANCELLED: 0,
};

export default async function ActivityScreen({
  params,
}: {
  params: Promise<{ qrCode: string }>;
}) {
  const { qrCode } = await params;
  const store = await cookies();
  const session = await resolveStaySession(store.get(GUEST_SESSION_COOKIE)?.value);

  if (!session) redirect(`/r/${encodeURIComponent(qrCode)}`);

  const base = `/r/${encodeURIComponent(qrCode)}`;

  const { property, orders, requests } = await withTenant(
    { tenantId: session.tenantId, propertyId: session.propertyId },
    async (tx) => ({
      property: await findProperty(tx, session.propertyId),
      orders: await listOrdersForContext(tx, { context: contextForSession(session) }),
      requests: await getRequestsForStay(tx, { stayId: session.stayId }),
    }),
  );

  // The PROPERTY's timezone, never the server's (CLAUDE.md "Dates").
  const timeZone = property?.timezone ?? 'Asia/Kolkata';
  const clock = new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone,
  });
  const at = (value: Date) =>
    clock.format(value).replace(/\s?([ap])\.?m\.?/i, (_, p: string) => `${p.toLowerCase()}m`);
  const now = Date.now();

  const entries: Entry[] = [
    ...orders.map((order): Entry => {
      const state = orderStateFor(order.status);
      const live = OPEN_TO_A_GUEST.includes(order.status);
      const progress = trackProgress(order.status);
      // The same promise the tracking screen keeps: the window's far end.
      const eta = live ? trackEta(order.status, order.promisedByAt) : null;
      const deadline = eta ? (eta.to ?? eta.from) : null;
      const behind = deadline && now > deadline.getTime()
        ? Math.max(1, Math.round((now - deadline.getTime()) / 60_000))
        : null;
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
        live,
        haltReason: order.haltReason,
        promise: deadline
          ? (behind !== null ? `about ${behind} min behind` : `by ${at(deadline)}`)
          : null,
        promiseLate: behind !== null,
        progress: progress.index > 0 ? progress : null,
      };
    }),
    ...requests.map((request): Entry => {
      const state = requestStateFor(request.status);
      const live = REQUEST_OPEN_TO_A_GUEST.includes(request.status);
      const step = REQUEST_STEP[request.status];
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
        promise: live
          ? describeSla(request.breached, request.secondsRemaining, request.slaTargetAt, at)
          : null,
        promiseLate: live && request.breached,
        progress: step > 0 ? { index: step, of: 4 } : null,
      };
    }),
  ].sort(byNewest);

  const live = entries.filter((entry) => entry.live);
  const past = entries.filter((entry) => !entry.live);

  return (
    <main className={styles.shell}>
      <header className={styles.bar}>
        <Link href={`${base}/home`} className={styles.back} aria-label="Back to room home">
          <ChevronLeft size={22} strokeWidth={1.5} aria-hidden="true" />
        </Link>
      </header>

      <div className={styles.intro}>
        <h1 className={styles.title}>Your requests</h1>
        <p className={styles.lede}>
          Everything room <span className="tabular">{session.roomNumber}</span> has asked
          for, newest first.
        </p>
      </div>

      {/* Only while something is moving. A history page that holds a stream
          open all night for things that finished on Tuesday is a battery cost
          with nothing to show for it. */}
      {live.length ? <LiveActivity propertyId={session.propertyId} /> : null}

      {entries.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyArch} aria-hidden="true" />
          <p className={styles.emptyTitle}>Nothing asked for yet</p>
          <p className={styles.emptyBody}>
            Anything you order from the kitchen or ask housekeeping for shows up
            here, with how far along it is.
          </p>
          <Link href={`${base}/menu`} className={styles.emptyCta}>See the menu</Link>
        </div>
      ) : null}

      {live.length ? (
        <section className={styles.group} aria-labelledby="activity-now">
          <h2 id="activity-now" className={styles.eyebrow}>Happening now</h2>
          <ul className={styles.cards}>
            {live.map((entry) => (
              <LiveRow key={entry.id} entry={entry} />
            ))}
          </ul>
        </section>
      ) : null}

      {past.length ? (
        <section className={styles.group} aria-labelledby="activity-past">
          <h2 id="activity-past" className={styles.eyebrow}>Earlier in this stay</h2>
          <ul className={styles.rows}>
            {past.map((entry) => (
              <PastRow key={entry.id} entry={entry} timeZone={timeZone} />
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}

/**
 * Something still moving: a card, its timeline in miniature, and its promise.
 */
function LiveRow({ entry }: { entry: Entry }) {
  return (
    <li>
      <Link href={entry.href} className={styles.card} data-late={entry.promiseLate}>
        <span className={styles.cardHead}>
          <span className={styles.state}>{entry.label}</span>
          {entry.promise ? (
            <span className={styles.promise} data-late={entry.promiseLate}>
              {entry.promiseLate ? <Clock size={14} strokeWidth={1.5} aria-hidden="true" /> : null}
              <span className="tabular">{entry.promise}</span>
            </span>
          ) : null}
        </span>

        {entry.progress ? <Progress progress={entry.progress} /> : null}

        <span className={styles.cardBody}>
          <span className={styles.summary}>{entry.summary}</span>
          {entry.amount ? (
            <span className={`${styles.amount} tabular`}>{entry.amount}</span>
          ) : null}
        </span>

        <span className={styles.meta}>
          {/* The kind, said on the row. A guest scanning a mixed list should
              not have to work out which of these was dinner. */}
          <span>{entry.kind}</span>
          <span aria-hidden="true">·</span>
          <span className="tabular">{entry.reference}</span>
          <ChevronRight className={styles.chevron} size={18} strokeWidth={1.5} aria-hidden="true" />
        </span>
      </Link>
    </li>
  );
}

/**
 * Finished with: a hairline row.
 *
 * A link, always — even a refused one. The screen behind it carries the words
 * the kitchen or the desk actually used, and somebody whose request was refused
 * is the person most likely to want to read them again.
 */
function PastRow({ entry, timeZone }: { entry: Entry; timeZone: string }) {
  return (
    <li>
      <Link href={entry.href} className={styles.row}>
        <span className={styles.rowMain}>
          <span className={styles.summary}>{entry.summary}</span>
          <span className={styles.meta}>
            <span className={styles.pastState} data-tone={entry.tone}>{entry.label}</span>
            <span aria-hidden="true">·</span>
            <span>{entry.kind}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular">{entry.at ? formatFolioDate(entry.at, timeZone) : '—'}</span>
          </span>
          {entry.haltReason ? (
            <span className={styles.reason}>“{entry.haltReason}”</span>
          ) : null}
        </span>
        {entry.amount ? (
          <span className={`${styles.amount} tabular`} data-tone={entry.tone}>{entry.amount}</span>
        ) : null}
      </Link>
    </li>
  );
}

/** The timeline in miniature: the same three kinds of dot, on a rail. */
function Progress({ progress }: { progress: { index: number; of: number } }) {
  return (
    <span
      className={styles.progress}
      role="img"
      aria-label={`Step ${progress.index} of ${progress.of}`}
    >
      {Array.from({ length: progress.of }, (_, i) => {
        const state = i + 1 < progress.index ? 'done' : i + 1 === progress.index ? 'active' : 'pending';
        return <span key={i} className={styles.progressDot} data-state={state} />;
      })}
    </span>
  );
}

/**
 * Newest first, across both kinds.
 *
 * An order with no `placed_at` cannot reach this list (`listOrdersForContext`
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
function describeSla(
  breached: boolean,
  secondsRemaining: number | null,
  target: Date | null,
  at: (value: Date) => string,
): string | null {
  if (secondsRemaining === null) return null;
  const minutes = Math.max(1, Math.round(Math.abs(secondsRemaining) / 60));
  if (breached) return `about ${minutes} min behind`;
  return target ? `by ${at(target)}` : `${minutes} min left`;
}
