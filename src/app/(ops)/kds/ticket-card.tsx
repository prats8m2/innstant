'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { KitchenTicket, OrderStatus } from '@/modules/ordering';
import { formatMinutes } from '@/lib/clock';
import { bumpOrder, setDishAvailability, type BumpState } from './actions';
import styles from './kds.module.css';

export interface TicketPermissions {
  accept: boolean;
  reject: boolean;
  advance: boolean;
  availability: boolean;
}

/**
 * What each status offers next, and what the button should say to a cook.
 *
 * Three hops from PLACED to READY, not the two the design draws. The design's
 * single "Accept · start cooking" collapses ACCEPTED and PREPARING, and those
 * are distinct states in the machine (transitions.ts) that the guest's tracking
 * screen renders differently — "we have your order" is not "a pan is on".
 * CLAUDE.md says ask before changing a state machine, so the button stayed
 * split and the two states share a column instead.
 */
const NEXT_ACTION: Partial<Record<OrderStatus, { to: OrderStatus; label: string }>> = {
  PLACED: { to: 'ACCEPTED', label: 'Accept' },
  ACCEPTED: { to: 'PREPARING', label: 'Start cooking' },
  PREPARING: { to: 'READY', label: 'Ready' },
  READY: { to: 'OUT_FOR_DELIVERY', label: 'Picked up' },
};

/**
 * The four things a kitchen says when it cannot make something.
 *
 * Chips rather than a free-text box, because at 9pm on a Saturday the box gets
 * "86" typed into it and the guest reads "86". The guest sees this string, so
 * each one is a whole sentence from their side.
 *
 * "Something else" is the escape hatch and opens the free-text field — the
 * design sends the literal word "Other", which tells a guest nothing about
 * their dinner and is the one message on this screen they will actually read.
 */
const REJECT_REASONS: readonly string[] = [
  'We have run out of it',
  'The kitchen has closed',
  'We cannot do that change',
];
const OTHER = 'Something else';

export function TicketCard({
  propertyId,
  ticket,
  now,
  timeZone,
  fresh,
  unavailable,
  permissions,
}: {
  propertyId: string;
  ticket: KitchenTicket;
  /** The board's shared clock. One timer for the screen, not one per ticket. */
  now: number;
  /** The PROPERTY's zone — never the tablet's (CLAUDE.md "Dates"). */
  timeZone: string;
  /** PLACED and nobody has looked at it yet. Drives the ring, not the machine. */
  fresh: boolean;
  unavailable: ReadonlyArray<{ id: string; name: string }>;
  permissions: TicketPermissions;
}) {
  const [state, action] = useActionState<BumpState, FormData>(bumpOrder, {});
  const [rejecting, setRejecting] = useState(false);

  const next = NEXT_ACTION[ticket.status];
  const mayAdvance = next
    ? next.to === 'ACCEPTED' ? permissions.accept : permissions.advance
    : false;

  // Reject is only offered while it is still honest — once a pan is on, the
  // machine refuses it and the button would be a lie.
  const mayReject = permissions.reject
    && (ticket.status === 'PLACED' || ticket.status === 'ACCEPTED');

  const heat = heatOf(ticket, now);

  return (
    <li className={styles.ticket} data-status={ticket.status} data-fresh={fresh} data-heat={heat}>
      <header className={styles.ticketHead}>
        <span className={`${styles.room} tabular`}>{ticket.roomNumber}</span>
        <span className={styles.ticketMeta}>
          <span className={`${styles.number} tabular`}>{ticket.orderNumber}</span>
          {ticket.placedAt ? (
            <span className={`${styles.placed} tabular`}>
              {clockOf(ticket.placedAt, timeZone)}
            </span>
          ) : null}
        </span>
        <Age ticket={ticket} now={now} heat={heat} />
      </header>

      {/* Above the dishes, never below: this is the line that stops someone
          being taken to hospital, and a cook reads top-down under pressure. */}
      {ticket.dietaryFlags.length ? (
        <p className={styles.allergy}>
          {ticket.dietaryFlags.map((f) => f.replace(/_/g, ' ').toLowerCase()).join(' · ')}
        </p>
      ) : null}

      <ul className={styles.lines}>
        {ticket.lines.map((line, i) => {
          const pulled = line.menuItemId
            ? unavailable.some((u) => u.id === line.menuItemId)
            : false;
          return (
            <li key={`${ticket.id}-${i}`} className={styles.line} data-pulled={pulled}>
              <span className={`${styles.quantity} tabular`}>{line.quantity}×</span>
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
              {permissions.availability && line.menuItemId && !pulled
                && (ticket.status === 'PLACED' || ticket.status === 'ACCEPTED') ? (
                <EightySix
                  propertyId={propertyId}
                  menuItemId={line.menuItemId}
                  name={line.name}
                />
              ) : null}
            </li>
          );
        })}
      </ul>

      {ticket.guestNotes ? <p className={styles.guestNote}>{ticket.guestNotes}</p> : null}

      {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}

      {rejecting ? (
        <RejectPanel
          propertyId={propertyId}
          orderId={ticket.id}
          action={action}
          onCancel={() => setRejecting(false)}
        />
      ) : (
        <footer className={styles.actions}>
          {mayReject ? (
            <button
              type="button"
              className={styles.refuse}
              onClick={() => setRejecting(true)}
            >
              Reject
            </button>
          ) : null}

          {next && mayAdvance ? (
            <form action={action} className={styles.actionForm}>
              <input type="hidden" name="propertyId" value={propertyId} />
              <input type="hidden" name="orderId" value={ticket.id} />
              <input type="hidden" name="to" value={next.to} />
              <BumpButton label={next.label} />
            </form>
          ) : null}

          {/* Nothing to do here but wait for a runner. Said out loud, because a
              card with no button reads as broken. */}
          {ticket.status === 'READY' ? (
            <p className={styles.waiting}>
              <span className={styles.waitDot} aria-hidden="true" />
              At the pass · runner told
            </p>
          ) : null}
        </footer>
      )}
    </li>
  );
}

/**
 * Why, in the guest's words.
 *
 * The reason is required by the machine (`reasonRequiredFor`), and the guest is
 * shown it verbatim. So the chips ARE the message — pick one and the ticket is
 * refused with that sentence — and "Something else" reveals a field rather than
 * sending a word that explains nothing.
 */
function RejectPanel({
  propertyId,
  orderId,
  action,
  onCancel,
}: {
  propertyId: string;
  orderId: string;
  action: (formData: FormData) => void;
  onCancel: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [other, setOther] = useState('');

  const isOther = picked === OTHER;
  const reason = isOther ? other.trim() : picked ?? '';

  return (
    <form action={action} className={styles.reject}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="to" value="REJECTED" />
      <input type="hidden" name="reason" value={reason} />

      <p className={styles.rejectLead}>Why? The guest sees this.</p>

      <div className={styles.reasons}>
        {[...REJECT_REASONS, OTHER].map((label) => (
          <button
            key={label}
            type="button"
            className={styles.reason}
            aria-pressed={picked === label}
            onClick={() => setPicked(label)}
          >
            {label}
          </button>
        ))}
      </div>

      {isOther ? (
        <input
          className={styles.otherReason}
          value={other}
          onChange={(e) => setOther(e.target.value)}
          placeholder="Tell them what happened."
          maxLength={200}
          aria-label="What the guest is told"
          autoFocus
        />
      ) : null}

      <div className={styles.rejectActions}>
        <button type="button" className={styles.keep} onClick={onCancel}>Keep it</button>
        <RejectButton disabled={!reason} />
      </div>
    </form>
  );
}

function RejectButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.confirmReject} disabled={disabled || pending}>
      {pending ? '…' : 'Reject order'}
    </button>
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
  const [state, action] = useActionState<BumpState, FormData>(setDishAvailability, {});

  return (
    <form action={action} className={styles.eightySixForm}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="menuItemId" value={menuItemId} />
      <input type="hidden" name="available" value="false" />
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

function BumpButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.primary} disabled={pending}>
      {pending ? '…' : label}
    </button>
  );
}

/**
 * How the number ages, measured against the PROMISE rather than a fixed number
 * of minutes: a 40-minute laal maas and a 10-minute chai are not late at the
 * same age, and a board that shouts at both teaches a kitchen to ignore it.
 *
 *   fresh   — under three quarters of the promise
 *   soon    — the last quarter
 *   late    — past it
 *
 * This is why the badge is not the design's flat under-8/under-14-minutes
 * ramp: the same two numbers for every dish is the thing this already
 * replaced.
 */
function heatOf(ticket: KitchenTicket, now: number): 'fresh' | 'soon' | 'late' {
  // At the pass the clock that matters is `ready_at` — food goes cold from
  // when it came off the pan, not from when the guest ordered.
  if (ticket.status === 'READY') {
    const ready = ticket.readyAt ? new Date(ticket.readyAt).getTime() : null;
    if (!ready) return 'fresh';
    const waiting = (now - ready) / 60_000;
    return waiting > 10 ? 'late' : waiting > 5 ? 'soon' : 'fresh';
  }

  if (!ticket.placedAt) return 'fresh';
  const placed = new Date(ticket.placedAt).getTime();
  const promise = ticket.promisedByAt ? new Date(ticket.promisedByAt).getTime() : null;

  if (!promise || promise <= placed) return 'fresh';
  if (now > promise) return 'late';
  return (now - placed) / (promise - placed) > 0.75 ? 'soon' : 'fresh';
}

/**
 * How long this has been waiting.
 *
 * Minutes, from the board's shared clock. A ticket at the pass counts from when
 * it was plated instead, because that is what the runner is racing.
 */
function Age({
  ticket,
  now,
  heat,
}: {
  ticket: KitchenTicket;
  now: number;
  heat: 'fresh' | 'soon' | 'late';
}) {
  const from = ticket.status === 'READY' ? ticket.readyAt ?? ticket.placedAt : ticket.placedAt;
  if (!from) return null;

  const minutes = Math.max(0, Math.round((now - new Date(from).getTime()) / 60_000));
  const age = formatMinutes(minutes);

  return (
    <span className={`${styles.age} tabular`} data-heat={heat} data-late={heat === 'late'}>
      {ticket.status === 'READY' ? `waiting ${age}` : age}
    </span>
  );
}

function clockOf(at: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone,
  }).format(new Date(at));
}
