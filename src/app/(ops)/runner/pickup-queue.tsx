'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  BedDouble, Bike, CircleAlert, ShoppingBag, UtensilsCrossed, type LucideIcon,
} from 'lucide-react';
import type { KitchenTicket } from '@/modules/ordering';
import { wallClock } from '../floor-header';
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
 *   With you            what you are carrying — one tap from "Handed over"
 *   At the pass         waiting for anyone, coldest first
 *   With other runners  somebody else has it; shown so nobody walks to the
 *                       pass for a tray that has gone, small and without a
 *                       button
 *
 * The sort inside each group is `runnerTickets()`'s — oldest on the pass
 * first — so the list never reorders under a thumb.
 *
 * Direction A draws more on the card than the product holds. What is left out
 * rather than invented: the guest's name, VIP, the floor (a ticket carries the
 * destination it was placed with, not the room's floor), the other runner's
 * name, and "No answer at the door" (a runner state that does not exist).
 */
export function PickupQueue({
  propertyId,
  staffUserId,
  tickets,
  timeZone,
  renderedAt,
}: {
  propertyId: string;
  staffUserId: string;
  tickets: KitchenTicket[];
  /** The PROPERTY's zone — "due 9:05pm" is the hotel's clock. */
  timeZone: string;
  /** The server's clock at render — the first tick, so hydration agrees. */
  renderedAt: number;
}) {
  const now = useNow(renderedAt);

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
            <Carrying
              key={ticket.id}
              propertyId={propertyId}
              ticket={ticket}
              now={now}
              timeZone={timeZone}
            />
          ))}
        </Group>
      ) : null}

      <Group title="At the pass" count={waiting.length}>
        {waiting.length ? waiting.map((ticket) => (
          <AtThePass key={ticket.id} propertyId={propertyId} ticket={ticket} now={now} />
        )) : <li className={styles.groupEmpty}>The pass is clear.</li>}
      </Group>

      {others.length ? (
        <Group title="With other runners" count={others.length} quiet>
          {others.map((ticket) => {
            const due = dueReading(ticket.promisedByAt, now);
            return (
              <li key={ticket.id} className={styles.otherRow}>
                <span className={styles.otherWhere}>
                  <span className={`${styles.otherRoom} tabular`} data-kind={ticket.roomNumber ? 'room' : 'label'}>
                    {bigLabel(ticket)}
                  </span>
                  <span className={`${styles.otherNumber} tabular`}>{ticket.orderNumber}</span>
                </span>
                {due ? (
                  <span className={`${styles.otherDue} tabular`} data-late={due.late}>
                    {due.late ? `${due.minutes}m over` : `due ${wallClock(ticket.promisedByAt!, timeZone)}`}
                  </span>
                ) : null}
              </li>
            );
          })}
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
        {title} <span className="tabular">{count}</span>
      </h2>
      <ul className={styles.queue}>{children}</ul>
    </section>
  );
}

/** A tray in your hands: the door, the clock, what is on it, and one button. */
function Carrying({
  propertyId,
  ticket,
  now,
  timeZone,
}: {
  propertyId: string;
  ticket: KitchenTicket;
  now: number;
  timeZone: string;
}) {
  const [state, action] = useActionState<MoveState, FormData>(moveTray, {});
  const fulfilment = FULFILMENT[ticket.fulfilment];
  const Icon = fulfilment.icon;
  const due = dueReading(ticket.promisedByAt, now);

  return (
    <li className={styles.tray} data-status={ticket.status} data-heat={due?.heat ?? 'ok'}>
      <header className={styles.trayHead}>
        <span className={`${styles.room} tabular`} data-kind={ticket.roomNumber ? 'room' : 'label'}>
          {bigLabel(ticket)}
        </span>
        {due ? (
          <span className={styles.due}>
            <span className={`${styles.dueBig} tabular`} data-late={due.late}>
              {due.late ? `+${due.minutes}m` : `${due.minutes}m`}
            </span>
            <span className={styles.dueSmall} data-late={due.late}>
              {due.late ? (
                <><CircleAlert size={12} aria-hidden="true" /> over · late</>
              ) : (
                <>left · due <span className="tabular">{wallClock(ticket.promisedByAt!, timeZone)}</span></>
              )}
            </span>
          </span>
        ) : (
          <span className={styles.dueSmall}>on the way</span>
        )}
      </header>

      <p className={styles.where}>
        <Icon size={16} strokeWidth={2} aria-hidden="true" />
        <span>{ticket.roomNumber ? fulfilment.label : ticket.destination}</span>
        <span aria-hidden="true">·</span>
        <span className="tabular">{ticket.orderNumber}</span>
      </p>

      <Allergy flags={ticket.dietaryFlags} />

      <p className={styles.items}>{itemsLine(ticket)}</p>

      {ticket.guestNotes ? <p className={styles.guestNote}>“{ticket.guestNotes}”</p> : null}

      {/* True only for a stay's order: `placeOrder()` posts it to the room's
          folio at placement (D-027). A visit pays at the counter or the door
          (D-079), and the ticket does not say which, so it says nothing. */}
      {ticket.roomNumber ? (
        <p className={styles.settled}>Charged to room. Nothing to collect.</p>
      ) : null}

      {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}

      <form action={action} className={styles.actionForm}>
        <input type="hidden" name="propertyId" value={propertyId} />
        <input type="hidden" name="orderId" value={ticket.id} />
        <input type="hidden" name="to" value="DELIVERED" />
        <MoveButton label="Handed over" primary />
      </form>
    </li>
  );
}

/** A tray waiting on the pass: the door, how long it has sat, and "Take it up". */
function AtThePass({
  propertyId,
  ticket,
  now,
}: {
  propertyId: string;
  ticket: KitchenTicket;
  now: number;
}) {
  const [state, action] = useActionState<MoveState, FormData>(moveTray, {});
  const minutes = ticket.readyAt
    ? Math.max(0, Math.round((now - new Date(ticket.readyAt).getTime()) / 60_000))
    : null;

  return (
    <li className={styles.passRow} data-status={ticket.status}>
      <div className={styles.passMain}>
        <span className={`${styles.passRoom} tabular`} data-kind={ticket.roomNumber ? 'room' : 'label'}>
          {bigLabel(ticket)}
        </span>
        <span className={styles.passBody}>
          <span className={styles.passItems}>{itemsLine(ticket)}</span>
          <span className={styles.passSub} data-cold={minutes !== null && minutes >= 10}>
            {/* Food goes cold from `ready_at`, which is what a runner races. */}
            {minutes === null ? 'On the pass' : minutes === 0 ? 'Ready just now' : (
              <>On the pass <span className="tabular">{minutes}</span> min</>
            )}
            {' · '}
            <span className="tabular">{ticket.orderNumber}</span>
          </span>
        </span>
        <form action={action} className={styles.passForm}>
          <input type="hidden" name="propertyId" value={propertyId} />
          <input type="hidden" name="orderId" value={ticket.id} />
          <input type="hidden" name="to" value="OUT_FOR_DELIVERY" />
          <MoveButton label="Take it up" />
        </form>
      </div>
      <Allergy flags={ticket.dietaryFlags} />
      {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}
    </li>
  );
}

/** The allergy line rides along to the door: it is what a runner repeats if
 *  the guest asks, and it is the one thing worth carrying twice. */
function Allergy({ flags }: { flags: string[] }) {
  if (!flags.length) return null;
  return (
    <p className={styles.allergy}>
      <CircleAlert size={14} aria-hidden="true" />
      {flags.map((f) => f.replace(/_/g, ' ').toLowerCase()).join(' · ')}
    </p>
  );
}

function MoveButton({ label, primary = false }: { label: string; primary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={primary ? styles.primary : styles.secondary} disabled={pending}>
      {pending ? '…' : label}
    </button>
  );
}

/** The big number: the room, or — for a table, takeaway or delivery — the
 *  ticket's own destination line. */
function bigLabel(ticket: KitchenTicket): string {
  return ticket.roomNumber ?? ticket.destination;
}

/** "Laal maas (extra roti), 2 × Soola chicken" — one line, as the board has it. */
function itemsLine(ticket: KitchenTicket): string {
  return ticket.lines
    .map((line) => {
      const name = line.modifiers.length ? `${line.name} (${line.modifiers.join(', ')})` : line.name;
      return line.quantity > 1 ? `${line.quantity} × ${name}` : name;
    })
    .join(', ');
}

/**
 * Minutes to the promise the guest was given, or past it. Null when the
 * order carries no promise.
 */
function dueReading(promisedByAt: Date | null, now: number) {
  if (!promisedByAt) return null;
  const seconds = Math.round((new Date(promisedByAt).getTime() - now) / 1000);
  const late = seconds < 0;
  const minutes = Math.max(0, Math.round(Math.abs(seconds) / 60));
  return {
    late,
    minutes,
    heat: late ? 'late' : minutes <= 5 ? 'soon' : 'ok',
  } as const;
}

/** One clock for the whole queue, so a tray's age moves without a refresh. */
function useNow(renderedAt: number): number {
  const [now, setNow] = useState(renderedAt);
  useEffect(() => {
    setNow(Date.now());
    const tick = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(tick);
  }, []);
  return now;
}
