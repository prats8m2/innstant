'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import type { KitchenTicket } from '@/modules/ordering';
import { moveTray, type MoveState } from './actions';
import styles from './runner.module.css';

/**
 * The pickup queue. One phone, one hand, walking.
 *
 * Oldest READY first, and it stays that way — the tray that has been on the
 * pass longest is the one going cold, and a queue that reorders while someone
 * is reaching for it is a queue they stop trusting.
 */
export function PickupQueue({
  propertyId,
  staffUserId,
  tickets,
}: {
  propertyId: string;
  staffUserId: string;
  tickets: KitchenTicket[];
}) {
  if (!tickets.length) {
    return (
      <p className={styles.empty}>
        Nothing waiting. A tray appears here the moment the kitchen plates it.
      </p>
    );
  }

  return (
    <ul className={styles.queue}>
      {tickets.map((ticket) => (
        <Tray
          key={ticket.id}
          propertyId={propertyId}
          staffUserId={staffUserId}
          ticket={ticket}
        />
      ))}
    </ul>
  );
}

function Tray({
  propertyId,
  staffUserId,
  ticket,
}: {
  propertyId: string;
  staffUserId: string;
  ticket: KitchenTicket;
}) {
  const [state, action] = useActionState<MoveState, FormData>(moveTray, {});

  const waiting = ticket.status === 'READY';
  const mine = ticket.assignedRunnerId === staffUserId;
  // Someone else is already carrying this one. The card stays visible — a
  // runner who walks to the pass needs to know why the tray is gone — but the
  // button does not, because two people carrying one tray is not a state.
  const takenByAnother = !waiting && ticket.assignedRunnerId !== null && !mine;

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
        <Since readyAt={ticket.readyAt} />
      </header>

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
        {takenByAnother ? (
          <p className={styles.withAnother}>Another runner has this one.</p>
        ) : (
          <form action={action} className={styles.actionForm}>
            <input type="hidden" name="propertyId" value={propertyId} />
            <input type="hidden" name="orderId" value={ticket.id} />
            <input type="hidden" name="to" value={waiting ? 'OUT_FOR_DELIVERY' : 'DELIVERED'} />
            <MoveButton label={waiting ? 'Take it up' : 'Handed over'} />
          </form>
        )}
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
 * How long the tray has been off the pan.
 *
 * From `ready_at`, not `placed_at`: what a runner is racing is food going cold,
 * and an order that took the kitchen forty minutes to cook is not late because
 * of that. Rendered on the client so it is the phone's clock — the runner is
 * standing in the same building as the food.
 */
function Since({ readyAt }: { readyAt: Date | null }) {
  if (!readyAt) return null;
  // `new Date(...)` even though the type says Date: a timestamp crossing into a
  // client component arrives as a string, and calling .getTime() on it is a
  // 500 on the server render — which is exactly how this was found. The
  // kitchen's `Age` does the same, for the same reason.
  const minutes = Math.max(0, Math.round((Date.now() - new Date(readyAt).getTime()) / 60_000));

  return (
    <span className={`${styles.since} tabular`} data-cold={minutes >= 10}>
      {minutes === 0 ? 'just now' : `${minutes} min`}
    </span>
  );
}
