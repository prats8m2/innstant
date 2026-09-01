'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { KitchenTicket, OrderStatus } from '@/modules/ordering';
import { bumpOrder, markItemUnavailable, type BumpState } from './actions';
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
  permissions: { accept: boolean; reject: boolean; advance: boolean; availability: boolean };
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
  permissions: { accept: boolean; reject: boolean; advance: boolean; availability: boolean };
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
            {/*
              86 the dish, from the screen the cook is already looking at. Only
              offered while the ticket is still the kitchen's — once it is on the
              pass, running out is a conversation, not a checkbox — and only when
              the dish still exists (the FK is SET NULL after archiving).
            */}
            {permissions.availability && line.menuItemId
              && (ticket.status === 'PLACED' || ticket.status === 'ACCEPTED') ? (
              <EightySix
                propertyId={propertyId}
                menuItemId={line.menuItemId}
                name={line.name}
              />
            ) : null}
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

/**
 * "We are out of this."
 *
 * A cook taps it, the dish leaves the guest menu, and the next guest simply
 * does not see it. It does not touch this order — what is already on the ticket
 * still has to be cooked or rejected with a reason.
 */
function EightySix({
  propertyId,
  menuItemId,
  name,
}: {
  propertyId: string;
  menuItemId: string;
  name: string;
}) {
  const [state, action] = useActionState<BumpState, FormData>(markItemUnavailable, {});

  return (
    <form action={action} className={styles.eightySixForm}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="menuItemId" value={menuItemId} />
      <EightySixButton name={name} />
      {state.error ? <span className={styles.error} role="alert">{state.error}</span> : null}
    </form>
  );
}

function EightySixButton({ name }: { name: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={styles.eightySix}
      disabled={pending}
      title={`Take ${name} off the guest menu — this order is unaffected`}
    >
      {pending ? '…' : '86'}
    </button>
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
  /**
   * Re-rendered on a timer, because a ticket nobody touches still gets older.
   *
   * The board refreshes on every order event, which in a working service is
   * often enough — but a kitchen with one ticket on it and nothing happening is
   * exactly when the number needs to be right. 20 seconds is far coarser than
   * the per-second counter the first version of this file rejected (twenty
   * tickets re-rendering every second on the kitchen's only screen) and fine
   * enough that the colour changes when it should.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 20_000);
    return () => window.clearInterval(tick);
  }, []);

  if (!placedAt) return null;

  const minutes = Math.max(0, Math.round((now - new Date(placedAt).getTime()) / 60_000));

  /**
   * How the number ages, measured against the promise rather than a fixed
   * number of minutes: a 40-minute laal maas and a 10-minute chai are not late
   * at the same age, and a board that shouts at both teaches a kitchen to
   * ignore it.
   *
   *   fresh   — under three quarters of the promise
   *   soon    — the last quarter
   *   late    — past it
   */
  const promise = promisedByAt ? new Date(promisedByAt).getTime() : null;
  const placed = new Date(placedAt).getTime();
  const heat = !promise || promise <= placed
    ? 'fresh'
    : now > promise
      ? 'late'
      : (now - placed) / (promise - placed) > 0.75
        ? 'soon'
        : 'fresh';

  return (
    <span className={`${styles.age} tabular`} data-heat={heat} data-late={heat === 'late'}>
      {minutes}m
    </span>
  );
}
