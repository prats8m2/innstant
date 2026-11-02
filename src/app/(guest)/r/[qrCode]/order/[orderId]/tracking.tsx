import Link from 'next/link';
import { ChevronDown, ChevronLeft, Clock, Phone } from 'lucide-react';
import type {
  PlacedOrderDetail, TrackEta, TrackFulfilment, TrackView,
} from '@/modules/ordering';
import { formatMoney, money } from '@/lib/money';
import { LiveOrder } from './live-order';
import styles from './order.module.css';

/**
 * The tracking screen itself — Direction A's `GuestTracking` board — shared by
 * the room flow (`/r/.../order/[id]`) and the property-link flow
 * (`/p/.../order/[id]`). An order moves through the same states whichever link
 * placed it; the two pages only decide the words that depend on WHERE it is
 * going and HOW it is paid, and hand them in.
 *
 * Server-rendered, so it is also the confirmation with JavaScript off: a
 * correct timeline, the promise and the order, just not the movement.
 *
 * Three states at the top, as the board draws them:
 *   - on time: the promise, large, in the accent;
 *   - running behind: said in words, in the soft late tone, with the promise
 *     it broke struck through — never an alarm, and never a new time the
 *     kitchen has not given (there is no revised estimate in the data);
 *   - at the door: the past tense and the time it was handed over.
 *
 * No runner or chef names. The board writes "Arjun is bringing it"; nothing on
 * the order says who is, and a name with no row behind it is a fiction.
 */
export interface OrderTrackingProps {
  order: PlacedOrderDetail;
  view: TrackView;
  eta: TrackEta | null;
  fulfilment: TrackFulfilment;
  timeZone: string;
  /** Rendered at request time — "late" is a function of the clock. */
  now: Date;
  /** The page's one h1: "Order to room 214", "Order to Table 4". */
  title: string;
  back: { href: string; label: string };
  /** The grand-total row: "Charged to room 214", "Total". */
  totalLabel: string;
  /** Where the money actually changes hands, under the totals. */
  payNote: string;
  /** A `tel:` number when the hotel has one, else null — never invented. */
  phone: string | null;
  /** The bottom row's other link: "Order something else". */
  next: { href: string; label: string };
}

export function OrderTracking({
  order, view, eta, fulfilment, timeZone, now, title, back, totalLabel, payNote, phone, next,
}: OrderTrackingProps) {
  // The PROPERTY's timezone, never the server's (CLAUDE.md "Dates").
  const clock = new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone,
  });
  /** `9:41pm`, not `9:41 PM` — the reference's own formatter. */
  const at = (value: Date | null) =>
    (value ? clock.format(value).replace(/\s?([ap])\.?m\.?/i, (_, p: string) => `${p.toLowerCase()}m`) : '');

  const arrived = eta?.label === 'Arrived at';
  /** The last moment the promise still holds: the window's far end, or the one time. */
  const deadline = view.live && eta && !arrived ? (eta.to ?? eta.from) : null;
  const behindMinutes = deadline && now.getTime() > deadline.getTime()
    ? Math.max(1, Math.round((now.getTime() - deadline.getTime()) / 60_000))
    : null;
  const late = behindMinutes !== null;

  const active = view.steps?.find((step) => step.state === 'active') ?? null;
  const lineCount = order.lines.reduce((sum, line) => sum + line.quantity, 0);
  const dishes = order.lines.map((line) => line.name).join(', ');

  return (
    <main className={styles.shell}>
      <header className={styles.bar}>
        <Link href={back.href} className={styles.back} aria-label={back.label}>
          <ChevronLeft size={22} strokeWidth={1.5} aria-hidden="true" />
        </Link>
        <h1 className={styles.barTitle}>
          {title}
          <span aria-hidden="true"> · </span>
          <span className="tabular">{order.orderNumber}</span>
        </h1>
        <span className={styles.barEnd} aria-hidden="true" />
      </header>

      {view.halt ? (
        <section className={styles.halt} role="status">
          <h2 className={styles.headline}>{view.halt.title}</h2>
          {view.halt.reason ? (
            <p className={styles.haltReason}>“{view.halt.reason}”</p>
          ) : null}
          <p className={styles.haltDetail}>{view.halt.detail}</p>
        </section>
      ) : (
        <section className={styles.hero} data-late={late}>
          {late ? (
            <p className={styles.behind}>
              <Clock size={16} strokeWidth={1.5} aria-hidden="true" />
              About <span className="tabular">{behindMinutes}</span>{' '}
              {behindMinutes === 1 ? 'minute' : 'minutes'} behind
            </p>
          ) : null}

          <h2 className={arrived ? `${styles.headline} ${styles.headlineDone}` : styles.headline}>
            {late ? 'Taking longer than we said.' : headlineFor(order.status, fulfilment)}
          </h2>

          {arrived && eta ? (
            <p className={styles.heroNote}>
              {handedOverFor(fulfilment)} at <span className="tabular">{at(eta.from)}</span>.
              {' '}Enjoy it.
            </p>
          ) : late && eta ? (
            <p className={styles.heroNote}>
              We said{' '}
              <s className="tabular">{eta.to ? `${at(eta.from)}–${at(eta.to)}` : at(eta.from)}</s>.
              {' '}It is still coming{phone ? ' — the desk can tell you where it is' : ''}.
            </p>
          ) : eta ? (
            <PromiseLine eta={eta} at={at} now={now} fulfilment={fulfilment} />
          ) : null}
        </section>
      )}

      {view.steps ? (
        <>
          {/* The one thing a screen reader needs from an animated timeline: what
              state the order is in now. The steps themselves are a list. */}
          <p className="sr-only" role="status">
            {active?.title ?? 'Order sent'}
            {late ? `, about ${behindMinutes} minutes behind` : ''}
          </p>

          <ol className={styles.steps} data-late={late}>
            {view.steps.map((step, i) => {
              const isLast = i === view.steps!.length - 1;
              const when = step.state === 'active' && view.live
                ? (late ? 'late' : 'now')
                : step.state === 'pending'
                  // The promise is the only future time the data holds, and it
                  // is the arrival — so only the last step is given one.
                  ? (isLast && eta && !arrived && !late ? `~${at(eta.from).replace(/[ap]m$/, '')}` : '')
                  : at(step.at);
              return (
                <li key={step.key} className={styles.step} data-state={step.state}>
                  <span className={styles.dot} aria-hidden="true" />
                  <span className={styles.stepBody}>
                    <span className={styles.stepTitle}>{step.title}</span>
                    <span className={styles.stepSub}>{step.sub}</span>
                  </span>
                  <span className={`${styles.stepTime} tabular`}>{when}</span>
                </li>
              );
            })}
          </ol>
        </>
      ) : null}

      <LiveOrder orderId={order.id} live={view.live} lateAt={deadline && !late ? deadline.toISOString() : null} />

      <div className={styles.foot} data-pinned={view.steps !== null}>
        {/*
          A <details>, not a toggle in state: it works with JavaScript off and a
          screen reader gets the disclosure semantics for free. Closed, it is
          the board's one-line summary card; open, it is the receipt.
        */}
        <details className={styles.summary}>
          <summary className={styles.summaryHead}>
            <span className={styles.summaryBody}>
              <span className={styles.summaryDishes}>{dishes}</span>
              <span className={styles.summaryMeta}>
                Your order · <span className="tabular">{lineCount}</span>{' '}
                {lineCount === 1 ? 'item' : 'items'}
                {order.guestNotes ? ` · ${order.guestNotes}` : ''}
              </span>
            </span>
            <span className={`${styles.summaryTotal} tabular`}>
              {formatMoney(money(order.totalMinor, order.currency))}
            </span>
            <ChevronDown className={styles.chevron} size={18} strokeWidth={1.5} aria-hidden="true" />
          </summary>

          <div className={styles.receipt}>
            <ul className={styles.lines}>
              {order.lines.map((line) => (
                <li key={line.id} className={styles.line}>
                  <span className={`${styles.quantity} tabular`}>{line.quantity}×</span>
                  <span className={styles.lineBody}>
                    <span className={styles.lineName}>{line.name}</span>
                    {line.modifiers.length ? (
                      <span className={styles.lineMods}>
                        {line.modifiers.map((m) => m.name).join(' · ')}
                      </span>
                    ) : null}
                    {line.notes ? <span className={styles.lineNote}>“{line.notes}”</span> : null}
                  </span>
                  <span className={`${styles.lineTotal} tabular`}>
                    {formatMoney(money(line.lineTotalMinor, order.currency))}
                  </span>
                </li>
              ))}
            </ul>

            <dl className={styles.totals}>
              <Row label="Subtotal" minor={order.subtotalMinor} order={order} />
              {order.serviceChargeMinor > 0 ? (
                <Row label="Service" minor={order.serviceChargeMinor} order={order} />
              ) : null}
              {order.taxMinor > 0 ? <Row label="Tax" minor={order.taxMinor} order={order} /> : null}
              {order.deliveryFeeMinor > 0 ? (
                <Row label="Delivery" minor={order.deliveryFeeMinor} order={order} />
              ) : null}
              {order.tipMinor > 0 ? <Row label="Tip" minor={order.tipMinor} order={order} /> : null}
              <Row label={totalLabel} minor={order.totalMinor} order={order} grand />
            </dl>

            <p className={styles.payNote}>{payNote}</p>
          </div>
        </details>

        <nav className={styles.actions} aria-label="Next">
          {phone ? (
            <a href={`tel:${phone}`} className={styles.action}>
              <Phone size={18} strokeWidth={1.5} aria-hidden="true" />
              {fulfilment === 'IN_ROOM' ? 'Call the desk' : 'Call us'}
            </a>
          ) : null}
          <Link href={next.href} className={`${styles.action} ${styles.actionQuiet}`}>
            {next.label}
          </Link>
        </nav>
      </div>
    </main>
  );
}

/** The promise while it is still being kept: the time, large, and how far off. */
function PromiseLine({
  eta, at, now, fulfilment,
}: {
  eta: TrackEta;
  at: (value: Date | null) => string;
  now: Date;
  fulfilment: TrackFulfilment;
}) {
  const from = splitMeridiem(at(eta.from));
  const to = eta.to ? splitMeridiem(at(eta.to)) : null;
  // "11:55am–12:07pm" keeps both; "9:05–9:17pm" says it once.
  const figure = to
    ? `${from.time}${from.meridiem !== to.meridiem ? from.meridiem : ''}–${to.time}`
    : from.time;
  const minutes = Math.round((eta.from.getTime() - now.getTime()) / 60_000);

  return (
    <p className={styles.promise}>
      <span className={`${styles.promiseTime} tabular`}>{figure}</span>
      <span className={styles.promiseNote}>
        {(to ?? from).meridiem} {whereFor(fulfilment)}
        {minutes > 0 ? (
          <> · about <span className="tabular">{minutes}</span> min</>
        ) : null}
      </span>
    </p>
  );
}

function Row({
  label, minor, order, grand = false,
}: {
  label: string; minor: number; order: PlacedOrderDetail; grand?: boolean;
}) {
  return (
    <div className={grand ? `${styles.row} ${styles.grand}` : styles.row}>
      <dt>{label}</dt>
      <dd className="tabular">{formatMoney(money(minor, order.currency))}</dd>
    </div>
  );
}

function splitMeridiem(value: string): { time: string; meridiem: string } {
  const m = /^(.*?)([ap]m)$/.exec(value);
  return m ? { time: m[1]!, meridiem: m[2]! } : { time: value, meridiem: '' };
}

/** "pm at your door" — what the promise is a promise OF. */
function whereFor(fulfilment: TrackFulfilment): string {
  switch (fulfilment) {
    case 'DINE_IN': return 'at your table';
    case 'TAKEAWAY': return 'ready to collect';
    case 'DELIVERY': return 'at your door';
    default: return 'at your door';
  }
}

function handedOverFor(fulfilment: TrackFulfilment): string {
  switch (fulfilment) {
    case 'DINE_IN': return 'Brought to your table';
    case 'TAKEAWAY': return 'Collected';
    case 'DELIVERY': return 'Delivered';
    default: return 'Handed over';
  }
}

/**
 * One sentence for where the order is, in the destination's own words.
 *
 * The step titles below already say it as a label; this says it as the
 * board's headline does — a sentence, set large. It reads the STATUS, so it
 * agrees with the timeline by construction.
 */
function headlineFor(status: PlacedOrderDetail['status'], fulfilment: TrackFulfilment): string {
  switch (status) {
    case 'PLACED': return 'Sent. The kitchen has it.';
    case 'ACCEPTED': return 'Taken. The kitchen is on it.';
    case 'PREPARING': return 'On the pan now.';
    case 'READY':
      return {
        IN_ROOM: 'Plated and covered. A runner is next.',
        DINE_IN: 'Plated. It comes over next.',
        TAKEAWAY: 'Bagged up. Nearly there.',
        DELIVERY: 'Packed. A rider is next.',
      }[fulfilment];
    case 'OUT_FOR_DELIVERY':
      return {
        IN_ROOM: 'On its way up to you.',
        DINE_IN: 'On its way to your table.',
        TAKEAWAY: 'Ready. Come to the counter.',
        DELIVERY: 'A rider has it.',
      }[fulfilment];
    case 'DELIVERED':
    case 'CLOSED':
      return {
        IN_ROOM: 'It is at your door.',
        DINE_IN: 'It is at your table.',
        TAKEAWAY: 'Collected.',
        DELIVERY: 'Delivered.',
      }[fulfilment];
    default:
      return 'Sending it through.';
  }
}
