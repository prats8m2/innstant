'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Camera } from 'lucide-react';
import type { RequestDetail, RequestStatus } from '@/modules/requests';
import { formatMoney, money } from '@/lib/money';
import { moveRequest, type BoardState } from './actions';
import styles from './housekeeping.module.css';

export interface BoardPermissions {
  assign: boolean;
  advance: boolean;
  verify: boolean;
}

export interface BoardFloor {
  id: string;
  name: string;
}

type FloorFilter = 'mine' | 'all' | string;

/**
 * The board, in the order a housekeeper's hands need it (D-090):
 *
 *   Yours              what you said you would do — always shown, every floor
 *   Waiting            nobody has it yet; the floors you cover, unless you ask
 *   With others        somebody has it — folded, so nobody walks to a room
 *                      that is already being seen to, but it is there to check
 *   Done, not checked  the second signature; open for whoever can give it
 *
 * The order inside each group is the server's (SLA target, soonest first) and
 * is never re-sorted here: a board that reorders under someone's thumb is a
 * board they stop trusting — the same rule the kitchen rail follows. Moving
 * between groups is the one exception, and it only ever happens to the card
 * that was just tapped.
 */
export function FloorRequests({
  propertyId,
  staffUserId,
  requests,
  floors,
  myFloorIds,
  permissions,
  renderedAt,
}: {
  propertyId: string;
  staffUserId: string;
  /** Every request not yet verified — COMPLETED included. */
  requests: RequestDetail[];
  floors: BoardFloor[];
  /** The floors this person's shift covers; empty when off shift. */
  myFloorIds: string[];
  permissions: BoardPermissions;
  /** The server's clock at render — the first tick, so hydration agrees. */
  renderedAt: number;
}) {
  const now = useNow(renderedAt);
  // "My floors" only means something when it is fewer than all of them.
  const hasZone = myFloorIds.length > 0 && myFloorIds.length < floors.length;
  // Null until somebody taps a chip: the default follows the shift, so
  // clocking in onto two floors narrows the board without a second tap.
  const [picked, setFilter] = useState<FloorFilter | null>(null);
  const filter = picked ?? (hasZone ? 'mine' : 'all');
  // A filter pointing at "mine" with no zone left would hide everything for no
  // reason — clocked out, or now covering every floor.
  const effective: FloorFilter = filter === 'mine' && !hasZone ? 'all' : filter;

  const shows = (r: RequestDetail) =>
    effective === 'all' ? true
      : effective === 'mine' ? myFloorIds.includes(r.floorId)
        : r.floorId === effective;

  const live = requests.filter((r) => r.status !== 'COMPLETED');
  const mine = live.filter((r) => r.assignedStaffId === staffUserId);
  const waitingAll = live.filter((r) => r.assignedStaffId === null);
  const othersAll = live.filter((r) => r.assignedStaffId !== null && r.assignedStaffId !== staffUserId);
  const toCheckAll = requests.filter((r) => r.status === 'COMPLETED');

  const waiting = waitingAll.filter(shows);
  const others = othersAll.filter(shows);
  const toCheck = toCheckAll.filter(shows);
  const hidden = waitingAll.length - waiting.length;

  if (!requests.length) {
    return (
      <p className={styles.empty}>
        Nothing waiting. A request appears here the moment a guest asks.
      </p>
    );
  }

  const countOn = (floorId: string) => live.filter((r) => r.floorId === floorId).length;
  const card = (request: RequestDetail) => (
    <Card
      key={request.id}
      propertyId={propertyId}
      staffUserId={staffUserId}
      request={request}
      permissions={permissions}
      now={now}
    />
  );

  return (
    <div className={styles.groups}>
      {floors.length > 1 ? (
        <div className={styles.floors} role="group" aria-label="Floors">
          {hasZone ? (
            <FloorChip
              label="My floors"
              count={live.filter((r) => myFloorIds.includes(r.floorId)).length}
              pressed={effective === 'mine'}
              onPress={() => setFilter('mine')}
            />
          ) : null}
          <FloorChip label="All" count={live.length} pressed={effective === 'all'} onPress={() => setFilter('all')} />
          {floors.map((floor) => (
            <FloorChip
              key={floor.id}
              label={floor.name}
              count={countOn(floor.id)}
              pressed={effective === floor.id}
              onPress={() => setFilter(floor.id)}
            />
          ))}
        </div>
      ) : null}

      {mine.length ? (
        <Group title="Yours" count={mine.length}>{mine.map(card)}</Group>
      ) : null}

      <Group title="Waiting for someone" count={waiting.length}>
        {waiting.length ? waiting.map(card) : (
          <li className={styles.groupEmpty}>
            {hidden ? 'Nothing waiting on these floors.' : 'Nobody is waiting. Every request has someone.'}
          </li>
        )}
      </Group>
      {hidden ? (
        <button type="button" className={styles.elsewhere} onClick={() => setFilter('all')}>
          {hidden} more waiting on other floors · Show all
        </button>
      ) : null}

      {others.length ? (
        <Group title="With others" count={others.length} folded>{others.map(card)}</Group>
      ) : null}

      {toCheck.length ? (
        <Group title="Done, not checked" count={toCheck.length} folded={!permissions.verify}>
          {toCheck.map(card)}
        </Group>
      ) : null}
    </div>
  );
}

function FloorChip({
  label, count, pressed, onPress,
}: {
  label: string; count: number; pressed: boolean; onPress: () => void;
}) {
  return (
    <button type="button" className={styles.chip} aria-pressed={pressed} onClick={onPress}>
      {label}
      <span className="tabular">{count}</span>
    </button>
  );
}

/**
 * A heading and its cards. `folded` puts the group behind its own heading — a
 * native disclosure, so it works without a line of state and reads correctly
 * to a screen reader.
 */
function Group({
  title, count, folded, children,
}: {
  title: string; count: number; folded?: boolean; children: React.ReactNode;
}) {
  const heading = (
    <>
      {title} <span className={`${styles.groupCount} tabular`}>{count}</span>
    </>
  );
  if (folded !== undefined) {
    return (
      <details className={styles.group} data-quiet="true" open={!folded}>
        <summary className={styles.groupTitle}>{heading}</summary>
        <ul className={styles.board}>{children}</ul>
      </details>
    );
  }
  return (
    <section className={styles.group}>
      <h2 className={styles.groupTitle}>{heading}</h2>
      <ul className={styles.board}>{children}</ul>
    </section>
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
  now,
}: {
  propertyId: string;
  staffUserId: string;
  request: RequestDetail;
  permissions: BoardPermissions;
  now: number;
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
  // The server's answer, not a re-derivation: `slaState()` returns null once
  // the work has stopped, and a card that keeps counting down a completed
  // request is the exact bug that function exists to prevent.
  const running = request.secondsRemaining !== null;
  const sla = running ? slaReading(request, now) : null;
  const askedMinutes = Math.max(0, Math.round((now - new Date(request.createdAt).getTime()) / 60_000));

  return (
    <li
      className={styles.card}
      data-status={request.status}
      // Late only while the clock runs: a finished request that ran over is
      // history for the report, not an alarm on the board.
      data-late={sla?.late === true}
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

        {sla ? (
          <span className={`${styles.countdown} tabular`} data-late={sla.late}>
            {sla.late ? `${sla.minutes}m over` : `${sla.minutes}m left`}
          </span>
        ) : null}
      </header>

      {/* How much of the promise is gone — the countdown says the number, the
          bar says it from across a corridor. */}
      {sla ? (
        <span className={styles.sla} data-heat={sla.heat} aria-hidden="true">
          <span style={{ width: `${Math.round(sla.used * 100)}%` }} />
        </span>
      ) : null}

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

      <p className={styles.meta}>
        <span className="tabular">
          {askedMinutes < 1 ? 'Asked just now' : `Asked ${askedMinutes} min ago`}
        </span>
        {/* A photo of the leak saves a trip. It is a link, not an inline image:
            this board is read on a phone on hotel wifi, and a full-size photo
            per card is a slow board. */}
        {request.photoUrl ? (
          <a className={styles.photo} href={request.photoUrl} target="_blank" rel="noreferrer">
            <Camera size={14} strokeWidth={2} aria-hidden="true" />
            Photo
          </a>
        ) : null}
        {withSomeoneElse ? (
          <span className={styles.assignee}>{request.assignedStaffName ?? 'Someone'} has this one</span>
        ) : mine ? (
          <span className={styles.assignee} data-mine="true">Yours</span>
        ) : null}
      </p>

      {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}

      <footer className={styles.actions}>
        <div className={styles.actionRow}>
          {next && mayMove ? (
            <form action={action} className={styles.actionForm} data-grow="true">
              <input type="hidden" name="propertyId" value={propertyId} />
              <input type="hidden" name="requestId" value={request.id} />
              <input type="hidden" name="to" value={next.to} />
              <input type="hidden" name="claim" value={String(next.claim)} />
              <MoveButton label={next.label} primary />
            </form>
          ) : null}

          {/*
            Handing it back. Offered only on a request that IS assigned — called
            away, wrong floor, already dealt with by someone else — and never
            once the work has started, because that is a completion or a
            rejection.
          */}
          {request.status === 'ASSIGNED' && permissions.assign ? (
            <form action={action} className={styles.actionForm}>
              <input type="hidden" name="propertyId" value={propertyId} />
              <input type="hidden" name="requestId" value={request.id} />
              <input type="hidden" name="to" value="OPEN" />
              <MoveButton label="Put it back" />
            </form>
          ) : null}
        </div>

        {/* Refusing is rare and the guest reads the reason, so it sits behind
            a tap instead of a text box on every card. */}
        {permissions.advance && request.status !== 'COMPLETED' ? (
          <details className={styles.cannot}>
            <summary>Cannot do it</summary>
            <form action={action} className={styles.actionForm}>
              <input type="hidden" name="propertyId" value={propertyId} />
              <input type="hidden" name="requestId" value={request.id} />
              <input type="hidden" name="to" value="REJECTED" />
              <input
                name="reason"
                className={styles.reason}
                placeholder="Why? The guest is told."
                aria-label="Why it cannot be done"
                maxLength={200}
                required
              />
              <MoveButton label="Tell them" />
            </form>
          </details>
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
 * Time left or over, and how much of the window is spent.
 *
 * Recomputed from the target on every tick, so a card turns late without
 * waiting for a refresh. `breached` from the server still wins: it was true at
 * render, and a client clock a few seconds behind must not un-late a card.
 */
function slaReading(request: RequestDetail, now: number) {
  if (!request.slaTargetAt) return null;
  // `new Date(...)`: a timestamp crossing into a client component arrives as a
  // string, and calling .getTime() on it is a 500 on the server render.
  const target = new Date(request.slaTargetAt).getTime();
  const start = new Date(request.createdAt).getTime();
  const seconds = Math.round((target - now) / 1000);
  const late = request.breached || seconds < 0;
  const used = target > start ? Math.min(1, Math.max(0, (now - start) / (target - start))) : 1;
  return {
    late,
    used: late ? 1 : used,
    heat: late ? 'late' : used >= 0.75 ? 'soon' : 'ok',
    minutes: Math.max(0, Math.round(Math.abs(seconds) / 60)),
  } as const;
}

/**
 * One clock for the whole board, on a 20-second tick: a request nobody touches
 * still gets closer to breaching, and this board's job is to show that before
 * it happens. The same interval the kitchen's ticket age uses — coarse enough
 * to cost nothing, fine enough to be true.
 */
function useNow(renderedAt: number): number {
  const [now, setNow] = useState(renderedAt);
  useEffect(() => {
    setNow(Date.now());
    const tick = window.setInterval(() => setNow(Date.now()), 20_000);
    return () => window.clearInterval(tick);
  }, []);
  return now;
}
