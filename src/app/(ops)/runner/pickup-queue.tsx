'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { BedDouble, Bike, ShoppingBag, UtensilsCrossed, type LucideIcon } from 'lucide-react';
import type { KitchenTicket } from '@/modules/ordering';
import { moveTray, type MoveState } from './actions';
import styles from './runner.module.css';

const FULFILMENT: Record<KitchenTicket['fulfilment'], { icon: LucideIcon; label: string }> = {
  IN_ROOM: { icon: BedDouble, label: 'Room service' },
  DINE_IN: { icon: UtensilsCrossed, label: 'Table' },
  TAKEAWAY: { icon: ShoppingBag, label: 'Takeaway' },
  DELIVERY: { icon: Bike, label: 'Delivery' },
};

/**
 * The runner's queue, in the order a runner's hands need it (D-089):
 *
 *   With you        what you are carrying — one tap from "Handed over"
 *   At the pass     waiting for anyone, coldest first
 *   With others     somebody else has it; shown so nobody walks to the pass
 *                   for a tray that has gone, small and without a button
 *
 * The sort inside each group is `runnerTickets()`'s — oldest on the pass
 * first — so the list never reorders under a thumb.
 */
export function PickupQueue({
  propertyId,
  staffUserId,
  tickets,
  renderedAt,
}: {
  propertyId: string;
  staffUserId: string;
  tickets: KitchenTicket[];
  /** The server's clock at render — the first tick, so hydration agrees. */
  renderedAt: number;
}) {
  const now = useMinute(renderedAt);

  if (!tickets.length) {
    return (
      <p className={styles.empty}>
        Nothing waiting. A tray appears here the moment the kitchen plates it.
      </p>
    );
  }

  const mine = tickets.filter((t) => t.status === 'OUT_FOR_DELIVERY' && t.assignedRunnerId === staffUserId);
  const waiting = tickets.filter((t) => t.status === 'READY');
  const others = tickets.filter((t) => t.status === 'OUT_FOR_DELIVERY' && t.assignedRunnerId !== staffUserId);

  return (
    <div className={styles.groups}>
      {mine.length ? (
        <Group title="With you" count={mine.length}>
          {mine.map((ticket) => (
            <Tray key={ticket.id} propertyId={propertyId} ticket={ticket} now={now} mine />
          ))}
        </Group>
      ) : null}

      <Group title="At the pass" count={waiting.length}>
        {waiting.length ? waiting.map((ticket) => (
          <Tray key={ticket.id} propertyId={propertyId} ticket={ticket} now={now} />
        )) : <li className={styles.groupEmpty}>The pass is clear.</li>}
      </Group>

      {others.length ? (
        <Group title="With other runners" count={others.length} quiet>
          {others.map((ticket) => (
            <li key={ticket.id} className={styles.otherTray}>
              <span className={styles.otherDest}>{ticket.destination}</span>
              <span className={`${styles.number} tabular`}>{ticket.orderNumber}</span>
            </li>
          ))}
        </Group>
      ) : null}
    </div>
  );
}

function Group({
  title, count, quiet = false, children,
}: {
  title: string; count: number; quiet?: boolean; children: React.ReactNode;
}) {
  return (
    <section className={styles.group} data-quiet={quiet}>
      <h2 className={styles.groupTitle}>
        {title} <span className={`${styles.groupCount} tabular`}>{count}</span>
      </h2>
      <ul className={styles.queue}>{children}</ul>
    </section>
  );
}

function Tray({
  propertyId,
  ticket,
  now,
  mine = false,
}: {
  propertyId: string;
  ticket: KitchenTicket;
  now: number;
  mine?: boolean;
}) {
  const [state, action] = useActionState<MoveState, FormData>(moveTray, {});
  const fulfilment = FULFILMENT[ticket.fulfilment];
  const Icon = fulfilment.icon;
  const itemCount = ticket.lines.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <li className={styles.tray} data-status={ticket.status}>
      <header className={styles.trayHead}>
        <span className={`${styles.room} tabular`}>{ticket.destination}</span>
        <span className={styles.trayMeta}>
          <span className={`${styles.number} tabular`}>{ticket.orderNumber}</span>
          <span className={styles.items}>
            {itemCount} {itemCount === 1 ? 'item' : 'items'}
          </span>
        </span>
        <Since readyAt={ticket.readyAt} now={now} mine={mine} />
      </header>

      <p className={styles.fulfilment}>
        <Icon size={14} strokeWidth={2} aria-hidden="true" />
        {fulfilment.label}
      </p>

      {/* The allergy line rides along to the door: it is what a runner repeats
          if the guest asks, and it is the one thing worth carrying twice. */}
      {ticket.dietaryFlags.length ? (
        <p className={styles.allergy}>
          {ticket.dietaryFlags.map((f) => f.replace(/_/g, ' ').toLowerCase()).join(' · ')}
        </p>
      ) : null}

      <ul className={styles.lines}>
        {ticket.lines.map((line, i) => (
          <li key={`${ticket.id}-${i}`} className={styles.line}>
            <span className={`${styles.quantity} tabular`}>{line.quantity}</span>
            <span className={styles.lineName}>{line.name}</span>
          </li>
        ))}
      </ul>

      {ticket.guestNotes ? <p className={styles.guestNote}>“{ticket.guestNotes}”</p> : null}

      {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}

      <footer className={styles.actions}>
        <form action={action} className={styles.actionForm}>
          <input type="hidden" name="propertyId" value={propertyId} />
          <input type="hidden" name="orderId" value={ticket.id} />
          <input type="hidden" name="to" value={mine ? 'DELIVERED' : 'OUT_FOR_DELIVERY'} />
          <MoveButton label={mine ? 'Handed over' : 'Take it up'} />
        </form>
      </footer>
    </li>
  );
}

function MoveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.primary} disabled={pending}>
      {pending ? '…' : label}
    </button>
  );
}

/**
 * How long since it came off the pan, which is what a runner is racing — cold
 * at ten minutes. For a tray in your hands it says "on the way" instead.
 */
function Since({ readyAt, now, mine }: { readyAt: Date | null; now: number; mine: boolean }) {
  if (mine) return <span className={styles.since}>on the way</span>;
  if (!readyAt) return null;
  const minutes = Math.max(0, Math.round((now - new Date(readyAt).getTime()) / 60_000));
  return (
    <span className={`${styles.since} tabular`} data-cold={minutes >= 10}>
      {minutes === 0 ? 'just now' : `${minutes} min`}
    </span>
  );
}

/** The minute, ticking, so a tray's age moves without a refresh. */
function useMinute(renderedAt: number): number {
  const [now, setNow] = useState(renderedAt);
  useEffect(() => {
    setNow(Date.now());
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(tick);
  }, []);
  return now;
}
