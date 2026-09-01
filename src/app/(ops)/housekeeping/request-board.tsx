'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { RequestDetail, RequestStatus } from '@/modules/requests';
import { formatMoney, money } from '@/lib/money';
import { moveRequest, type BoardState } from './actions';
import styles from './housekeeping.module.css';

export interface BoardPermissions {
  assign: boolean;
  advance: boolean;
  verify: boolean;
}

/**
 * The cards.
 *
 * One column, because this is read on a phone while walking. The order comes
 * from the server (SLA target, soonest first) and is never re-sorted here: a
 * board that reorders under someone's thumb is a board they stop trusting —
 * the same rule the kitchen rail follows.
 */
export function RequestBoard({
  propertyId,
  staffUserId,
  requests,
  permissions,
}: {
  propertyId: string;
  staffUserId: string;
  requests: RequestDetail[];
  permissions: BoardPermissions;
}) {
  if (!requests.length) {
    return (
      <p className={styles.empty}>
        Nothing waiting. A request appears here the moment a guest asks.
      </p>
    );
  }

  return (
    <ul className={styles.board}>
      {requests.map((request) => (
        <Card
          key={request.id}
          propertyId={propertyId}
          staffUserId={staffUserId}
          request={request}
          permissions={permissions}
        />
      ))}
    </ul>
  );
}

/** What each status offers next, and what the button says to the person holding it. */
const NEXT: Partial<Record<RequestStatus, { to: RequestStatus; label: string; claim: boolean }>> = {
  OPEN: { to: 'IN_PROGRESS', label: 'I am going', claim: true },
  ASSIGNED: { to: 'IN_PROGRESS', label: 'On my way', claim: false },
  IN_PROGRESS: { to: 'COMPLETED', label: 'Done', claim: false },
  COMPLETED: { to: 'VERIFIED', label: 'Checked', claim: false },
};

function Card({
  propertyId,
  staffUserId,
  request,
  permissions,
}: {
  propertyId: string;
  staffUserId: string;
  request: RequestDetail;
  permissions: BoardPermissions;
}) {
  const [state, action] = useActionState<BoardState, FormData>(moveRequest, {});

  const next = NEXT[request.status];
  const mayMove = next
    ? next.to === 'VERIFIED'
      ? permissions.verify
      : next.claim ? permissions.assign : permissions.advance
    : false;

  const mine = request.assignedStaffId === staffUserId;
  const withSomeoneElse = request.assignedStaffId !== null && !mine;

  return (
    <li
      className={styles.card}
      data-status={request.status}
      data-late={request.breached}
      data-escalation={request.escalationLevel}
    >
      <header className={styles.cardHead}>
        <span className={`${styles.room} tabular`}>{request.roomNumber}</span>
        <span className={styles.where}>
          <span className={styles.floor}>{request.floorName}</span>
          <span className={`${styles.ref} tabular`}>{request.requestNumber}</span>
        </span>
        {/*
          Escalation is not a status (DATA-MODEL §6) — it sits alongside whatever
          the request is actually doing, which is usually IN_PROGRESS. Level 2
          means the duty manager has been told, and saying so on the card is what
          stops two people chasing the same thing.
        */}
        {request.escalationLevel > 0 ? (
          <span className={styles.escalated} data-level={request.escalationLevel}>
            {request.escalationLevel >= 2 ? 'Manager told' : 'Late'}
          </span>
        ) : null}

        <Countdown
          slaTargetAt={request.slaTargetAt}
          breached={request.breached}
          // The server's answer, not a re-derivation: `slaState()` returns null
          // once the work has stopped, and a card that keeps counting down a
          // completed request is the exact bug that function exists to prevent.
          running={request.secondsRemaining !== null}
        />
      </header>

      <ul className={styles.lines}>
        {request.lines.map((line, i) => (
          <li key={`${request.id}-${i}`} className={styles.line}>
            <span className={`${styles.qty} tabular`}>{line.quantity}</span>
            <span className={styles.label}>{line.label}</span>
            {line.lineTotalMinor > 0 ? (
              <span className={`${styles.charge} tabular`}>
                {formatMoney(money(line.lineTotalMinor, request.currency))}
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      {request.guestNote ? <p className={styles.note}>“{request.guestNote}”</p> : null}

      {/* A photo of the leak saves a trip. It is a link, not an inline image:
          this board is read on a phone on hotel wifi, and a full-size photo per
          card is a slow board. */}
      {request.photoUrl ? (
        <a className={styles.photo} href={request.photoUrl} target="_blank" rel="noreferrer">
          The guest sent a photo
        </a>
      ) : null}

      {withSomeoneElse ? (
        <p className={styles.assignee}>
          {request.assignedStaffName ?? 'Someone'} has this one
        </p>
      ) : mine ? (
        <p className={styles.assignee} data-mine="true">Yours</p>
      ) : null}

      {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}

      <footer className={styles.actions}>
        {next && mayMove ? (
          <form action={action} className={styles.actionForm}>
            <input type="hidden" name="propertyId" value={propertyId} />
            <input type="hidden" name="requestId" value={request.id} />
            <input type="hidden" name="to" value={next.to} />
            <input type="hidden" name="claim" value={String(next.claim)} />
            <MoveButton label={next.label} primary />
          </form>
        ) : null}

        {/*
          Handing it back. Offered only on a request that IS assigned — called
          away, wrong floor, already dealt with by someone else — and never once
          the work has started, because that is a completion or a rejection.
        */}
        {request.status === 'ASSIGNED' && permissions.assign ? (
          <form action={action} className={styles.actionForm}>
            <input type="hidden" name="propertyId" value={propertyId} />
            <input type="hidden" name="requestId" value={request.id} />
            <input type="hidden" name="to" value="OPEN" />
            <MoveButton label="Put it back" />
          </form>
        ) : null}

        {permissions.advance && request.status !== 'COMPLETED' ? (
          <form action={action} className={styles.actionForm}>
            <input type="hidden" name="propertyId" value={propertyId} />
            <input type="hidden" name="requestId" value={request.id} />
            <input type="hidden" name="to" value="REJECTED" />
            <input
              name="reason"
              className={styles.reason}
              placeholder="Why? The guest is told."
              maxLength={200}
              required
            />
            <MoveButton label="Cannot do it" />
          </form>
        ) : null}
      </footer>
    </li>
  );
}

function MoveButton({ label, primary = false }: { label: string; primary?: boolean }) {
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
 * Time left, or time over.
 *
 * Re-rendered on a 20-second tick, because a request nobody touches still gets
 * closer to breaching — and this board's whole job is to make that visible
 * before it happens. The same interval the kitchen's ticket age uses, and for
 * the same reason: coarse enough to cost nothing, fine enough to be true.
 *
 * The server already computed `breached` for the moment the page rendered; this
 * recomputes from the target so the card does not wait for a refresh to turn.
 */
function Countdown({
  slaTargetAt,
  breached,
  running,
}: {
  slaTargetAt: Date | null;
  breached: boolean;
  /** False once the request is finished — the clock stops with the work. */
  running: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 20_000);
    return () => window.clearInterval(tick);
  }, []);

  if (!slaTargetAt || !running) return null;

  // `new Date(...)`: a timestamp crossing into a client component arrives as a
  // string, and calling .getTime() on it is a 500 on the server render.
  const target = new Date(slaTargetAt).getTime();
  const seconds = Math.round((target - now) / 1000);
  const late = breached || seconds < 0;
  const minutes = Math.max(0, Math.round(Math.abs(seconds) / 60));

  return (
    <span className={`${styles.countdown} tabular`} data-late={late}>
      {late ? `${minutes}m over` : `${minutes}m left`}
    </span>
  );
}
