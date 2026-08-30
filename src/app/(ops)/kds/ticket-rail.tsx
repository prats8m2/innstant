'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import type { KitchenTicket, OrderStatus } from '@/modules/ordering';
import { bumpOrder, type BumpState } from './actions';
import styles from './kds.module.css';

/**
 * The rail. Oldest ticket first, and it stays that way — a board that reorders
 * under a cook's hand is a board they stop trusting.
 */
export function TicketRail({
  propertyId,
  tickets,
  permissions,
}: {
  propertyId: string;
  tickets: KitchenTicket[];
  permissions: { accept: boolean; reject: boolean; advance: boolean };
}) {
  if (!tickets.length) {
    return <p className={styles.empty}>Nothing on. The next order appears here on its own.</p>;
  }

  return (
    <ul className={styles.rail}>
      {tickets.map((ticket) => (
        <Ticket
          key={ticket.id}
          propertyId={propertyId}
          ticket={ticket}
          permissions={permissions}
        />
      ))}
    </ul>
  );
}

/** What each status offers next, and what the button should say to a cook. */
const NEXT_ACTION: Partial<Record<OrderStatus, { to: OrderStatus; label: string }>> = {
  PLACED: { to: 'ACCEPTED', label: 'Accept' },
  ACCEPTED: { to: 'PREPARING', label: 'Start cooking' },
  PREPARING: { to: 'READY', label: 'Ready' },
  READY: { to: 'OUT_FOR_DELIVERY', label: 'Picked up' },
};

function Ticket({
  propertyId,
  ticket,
  permissions,
}: {
  propertyId: string;
  ticket: KitchenTicket;
  permissions: { accept: boolean; reject: boolean; advance: boolean };
}) {
  const [state, action] = useActionState<BumpState, FormData>(bumpOrder, {});
  const next = NEXT_ACTION[ticket.status];
  const mayAdvance = next
    ? next.to === 'ACCEPTED' ? permissions.accept : permissions.advance
    : false;

  return (
    <li className={styles.ticket} data-status={ticket.status}>
      <header className={styles.ticketHead}>
        <span className={`${styles.room} tabular`}>{ticket.roomNumber}</span>
        <span className={`${styles.number} tabular`}>{ticket.orderNumber}</span>
        <Age placedAt={ticket.placedAt} promisedByAt={ticket.promisedByAt} />
      </header>

      {/* Above the dishes, never below: this is the line that stops someone
          being taken to hospital, and a cook reads top-down under pressure. */}
      {ticket.dietaryFlags.length ? (
        <p className={styles.allergy}>
          {ticket.dietaryFlags.map((f) => f.replace(/_/g, ' ').toLowerCase()).join(' · ')}
        </p>
      ) : null}

      <ul className={styles.lines}>
        {ticket.lines.map((line, i) => (
          <li key={`${ticket.id}-${i}`} className={styles.line}>
            <span className={`${styles.quantity} tabular`}>{line.quantity}</span>
            <span className={styles.lineBody}>
              <span className={styles.lineName}>{line.name}</span>
              {line.modifiers.length ? (
                <span className={styles.lineMods}>{line.modifiers.join(' · ')}</span>
              ) : null}
              {line.notes ? <span className={styles.lineNote}>“{line.notes}”</span> : null}
            </span>
          </li>
        ))}
      </ul>

      {ticket.guestNotes ? <p className={styles.guestNote}>“{ticket.guestNotes}”</p> : null}

      {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}

      <footer className={styles.actions}>
        {next && mayAdvance ? (
          <form action={action} className={styles.actionForm}>
            <input type="hidden" name="propertyId" value={propertyId} />
            <input type="hidden" name="orderId" value={ticket.id} />
            <input type="hidden" name="to" value={next.to} />
            <BumpButton label={next.label} primary />
          </form>
        ) : null}

        {/* Reject is only offered while it is still honest — once a pan is on,
            the machine refuses it and the button would be a lie. */}
        {permissions.reject && (ticket.status === 'PLACED' || ticket.status === 'ACCEPTED') ? (
          <form action={action} className={styles.actionForm}>
            <input type="hidden" name="propertyId" value={propertyId} />
            <input type="hidden" name="orderId" value={ticket.id} />
            <input type="hidden" name="to" value="REJECTED" />
            <input
              name="reason"
              className={styles.reason}
              placeholder="Why? The guest is told."
              maxLength={200}
              required
            />
            <BumpButton label="Cannot make it" />
          </form>
        ) : null}
      </footer>
    </li>
  );
}

function BumpButton({ label, primary = false }: { label: string; primary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={primary ? styles.primary : styles.secondary}
      disabled={pending}
    >
      {pending ? '…' : label}
    </button>
  );
}

/**
 * How long this ticket has been waiting, and whether it is late.
 *
 * Rendered from the server's timestamps without a live clock: a ticking counter
 * on twenty tickets is twenty re-renders a second on a tablet that is also the
 * kitchen's only screen. The board refreshes on every order event anyway, which
 * in a working service is often enough.
 */
function Age({ placedAt, promisedByAt }: { placedAt: Date | null; promisedByAt: Date | null }) {
  if (!placedAt) return null;
  const minutes = Math.max(0, Math.round((Date.now() - new Date(placedAt).getTime()) / 60_000));
  const late = promisedByAt ? Date.now() > new Date(promisedByAt).getTime() : false;

  return (
    <span className={`${styles.age} tabular`} data-late={late}>
      {minutes}m
    </span>
  );
}
