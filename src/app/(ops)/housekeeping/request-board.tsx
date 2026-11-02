'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Camera, CircleAlert } from 'lucide-react';
import type { RequestDetail, RequestStatus } from '@/modules/requests';
import { formatMoney, money } from '@/lib/money';
import { wallClock } from '../floor-header';
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
 * The board, in the order a housekeeper's hands need it (D-090), drawn to
 * Direction A's board (design/reference/direction-a/Housekeeping.dc.html):
 *
 *   Yours              what you said you would do — always shown, every
 *                      floor; big cards, one tap from the next step
 *   Waiting            nobody has it yet; the floors you cover, unless you ask
 *   Rooms to make up   (D-096) passed in by the page, between the two halves
 *   With others        somebody has it — one line each, so nobody walks to a
 *                      room already being seen to; tap a line for its actions
 *   Done, not checked  the second signature; open for whoever can give it
 *
 * The order inside each group is the server's (SLA target, soonest first) and
 * is never re-sorted here: a board that reorders under someone's thumb is a
 * board they stop trusting — the same rule the kitchen rail follows. Moving
 * between groups is the one exception, and it only ever happens to the card
 * that was just tapped.
 *
 * The board's wording is kept where an end-to-end test or a guest depends on
 * it: "I am going" (the board says "Take it"), "On my way", "Done", and the
 * countdown as "9m left" (the board writes "9:40 left").
 */
export function FloorRequests({
  propertyId,
  staffUserId,
  requests,
  floors,
  myFloorIds,
  permissions,
  timeZone,
  renderedAt,
  makeUp,
}: {
  propertyId: string;
  staffUserId: string;
  /** Every request not yet verified — COMPLETED included. */
  requests: RequestDetail[];
  floors: BoardFloor[];
  /** The floors this person's shift covers; empty when off shift. */
  myFloorIds: string[];
  permissions: BoardPermissions;
  /** The PROPERTY's zone — "due 9:05pm" is the hotel's clock. */
  timeZone: string;
  /** The server's clock at render — the first tick, so hydration agrees. */
  renderedAt: number;
  /** Rooms to make up (D-096), drawn between the live work and the rest. */
  makeUp?: React.ReactNode;
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

  const card = (variant: Variant) => (request: RequestDetail) => (
    <Card
      key={request.id}
      variant={variant}
      propertyId={propertyId}
      staffUserId={staffUserId}
      request={request}
      permissions={permissions}
      now={now}
      timeZone={timeZone}
    />
  );

  const countOn = (floorId: string) => live.filter((r) => r.floorId === floorId).length;

  return (
    <div className={styles.groups}>
      {floors.length > 1 && requests.length ? (
        <div className={styles.floors} role="group" aria-label="Floors">
          {hasZone ? (
            <FloorChip
              label="My floors"
              count={live.filter((r) => myFloorIds.includes(r.floorId)).length}
              pressed={effective === 'mine'}
              onPress={() => setFilter('mine')}
            />
          ) : null}
          {floors.map((floor) => (
            <FloorChip
              key={floor.id}
              label={floor.name}
              count={countOn(floor.id)}
              pressed={effective === floor.id}
              onPress={() => setFilter(floor.id)}
            />
          ))}
          <FloorChip label="All" count={live.length} pressed={effective === 'all'} onPress={() => setFilter('all')} />
        </div>
      ) : null}

      {!requests.length ? (
        <p className={styles.empty}>
          Nothing waiting. A request appears here the moment a guest asks.
        </p>
      ) : null}

      {mine.length ? (
        <Group title="Yours" count={mine.length}>{mine.map(card('full'))}</Group>
      ) : null}

      {requests.length ? (
        <Group title="Waiting" count={waiting.length}>
          {waiting.length ? waiting.map(card('row')) : (
            <li className={styles.groupEmpty}>
              {hidden ? 'Nothing waiting on these floors.' : 'Nobody is waiting. Every request has someone.'}
            </li>
          )}
        </Group>
      ) : null}
      {hidden ? (
        <button type="button" className={styles.elsewhere} onClick={() => setFilter('all')}>
          <span className="tabular">{hidden}</span> more waiting on other floors · Show all
        </button>
      ) : null}

      {makeUp}

      {others.length ? (
        <Group title="With others" count={others.length} folded={false} quiet>
          {others.map(card('quiet'))}
        </Group>
      ) : null}

      {toCheck.length ? (
        <Group title="Done, not checked" count={toCheck.length} folded={!permissions.verify} quiet>
          {toCheck.map(card('quiet'))}
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
  title, count, folded, quiet = false, children,
}: {
  title: string; count: number; folded?: boolean; quiet?: boolean; children: React.ReactNode;
}) {
  const heading = (
    <>
      <span>{title}</span> <span className="tabular">{count}</span>
    </>
  );
  if (folded !== undefined) {
    return (
      <details className={styles.group} data-quiet={quiet} open={!folded}>
        <summary className={styles.groupTitle}>{heading}</summary>
        <ul className={styles.board}>{children}</ul>
      </details>
    );
  }
  return (
    <section className={styles.group} data-quiet={quiet}>
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

type Variant = 'full' | 'row' | 'quiet';

function Card({
  variant,
  propertyId,
  staffUserId,
  request,
  permissions,
  now,
  timeZone,
}: {
  variant: Variant;
  propertyId: string;
  staffUserId: string;
  request: RequestDetail;
  permissions: BoardPermissions;
  now: number;
  timeZone: string;
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
  const what = whatLine(request);

  const nextForm = next && mayMove ? (
    <form action={action} className={styles.actionForm} data-grow={variant === 'full'}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="requestId" value={request.id} />
      <input type="hidden" name="to" value={next.to} />
      <input type="hidden" name="claim" value={String(next.claim)} />
      <MoveButton label={next.label} kind={variant === 'full' ? 'primary' : 'secondary'} />
    </form>
  ) : null;

  const meta = (
    <p className={styles.meta}>
      <span>{request.floorName}</span>
      <span className="tabular">{request.requestNumber}</span>
      <span className="tabular">
        {askedMinutes < 1 ? 'Asked just now' : `Asked ${askedMinutes} min ago`}
      </span>
      {/* A photo of the leak saves a trip. A link, not an inline image: this
          board is read on a phone on hotel wifi. */}
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
  );

  /*
    Escalation is not a status (DATA-MODEL §6) — it sits alongside whatever the
    request is actually doing. Level 2 means the duty manager has been told, and
    saying so on the card is what stops two people chasing the same thing.
  */
  const escalation = request.escalationLevel > 0 ? (
    <span className={styles.escalated} data-level={request.escalationLevel}>
      <CircleAlert size={12} aria-hidden="true" />
      {request.escalationLevel >= 2 ? 'Manager told' : 'Late'}
    </span>
  ) : null;

  const secondary = (
    <SecondaryActions
      request={request}
      propertyId={propertyId}
      permissions={permissions}
      action={action}
    />
  );

  const error = state.error ? <p className={styles.error} role="alert">{state.error}</p> : null;

  if (variant === 'quiet') {
    // A COMPLETED request has nothing left but the second signature, so its
    // line carries the button; anything still running opens on a tap.
    const side = sla ? (
      <span className={`${styles.quietSide} tabular`} data-late={sla.late}>
        {sla.late ? `${sla.minutes}m over` : `${sla.minutes}m left`}
      </span>
    ) : request.status === 'COMPLETED' ? (
      <span className={styles.quietSide}>needs a check</span>
    ) : null;
    const line = (
      <>
        <span className={styles.quietMain}>
          <span className={`${styles.quietRoom} tabular`}>{request.roomNumber}</span>
          <span className={styles.quietWhat}>
            {request.assignedStaffName ? `${firstName(request.assignedStaffName)} · ` : ''}{what}
          </span>
        </span>
        <span className={styles.quietEnd}>
          {side}
          <span className={`${styles.quietRef} tabular`}>{request.requestNumber}</span>
        </span>
      </>
    );
    return (
      <li
        className={styles.quietRow}
        data-status={request.status}
        data-late={sla?.late === true}
        data-escalation={request.escalationLevel}
      >
        {request.status === 'COMPLETED' ? (
          <div className={styles.quietLine}>
            {line}
            {nextForm}
          </div>
        ) : (
          <details className={styles.quietMore}>
            <summary className={styles.quietLine}>{line}</summary>
            <div className={styles.quietBody}>
              {request.guestNote ? <p className={styles.note}>“{request.guestNote}”</p> : null}
              {meta}
              {escalation}
              {error}
              {nextForm || secondary ? (
                <div className={styles.actions}>
                  {nextForm}
                  {secondary}
                </div>
              ) : null}
            </div>
          </details>
        )}
        {request.status === 'COMPLETED' ? error : null}
      </li>
    );
  }

  if (variant === 'row') {
    return (
      <li
        className={styles.rowCard}
        data-status={request.status}
        data-late={sla?.late === true}
        data-escalation={request.escalationLevel}
      >
        <div className={styles.rowMain}>
          <span className={`${styles.rowRoom} tabular`}>{request.roomNumber}</span>
          <span className={styles.rowBody}>
            <span className={styles.rowLabel}>{what}</span>
            {sla ? (
              <span className={`${styles.rowSub} tabular`} data-tone={sla.late ? 'crit' : sla.heat === 'soon' ? 'warn' : 'pos'}>
                {sla.late ? `${sla.minutes}m over` : `${sla.minutes}m left`}
              </span>
            ) : null}
          </span>
          {nextForm}
        </div>
        {request.guestNote ? <p className={styles.note}>“{request.guestNote}”</p> : null}
        {meta}
        {escalation}
        {error}
        {secondary}
      </li>
    );
  }

  return (
    <li
      className={styles.card}
      data-status={request.status}
      data-heat={sla?.heat ?? 'ok'}
      // Late only while the clock runs: a finished request that ran over is
      // history for the report, not an alarm on the board.
      data-late={sla?.late === true}
      data-escalation={request.escalationLevel}
    >
      <header className={styles.cardHead}>
        <span className={`${styles.room} tabular`}>{request.roomNumber}</span>
        {sla ? (
          <span className={styles.countdown}>
            <span className={`${styles.countBig} tabular`} data-tone={sla.late ? 'crit' : sla.heat === 'soon' ? 'warn' : 'pos'}>
              {sla.late ? `+${sla.minutes}m` : `${sla.minutes}m`}
            </span>
            {' '}
            <span className={styles.countSmall} data-late={sla.late}>
              {sla.late ? 'over · late' : (
                <>left{request.slaTargetAt ? <> · due <span className="tabular">{wallClock(request.slaTargetAt, timeZone)}</span></> : null}</>
              )}
            </span>
          </span>
        ) : null}
      </header>

      <ul className={styles.lines}>
        {request.lines.map((line, i) => (
          <li key={`${request.id}-${i}`} className={styles.line}>
            {line.quantity > 1 ? <span className={`${styles.qty} tabular`}>{line.quantity} ×</span> : null}
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

      {meta}
      {escalation}
      {error}

      <footer className={styles.actions}>
        {nextForm}
        {secondary}
      </footer>
    </li>
  );
}

/**
 * Handing it back, and refusing it. Both are rare, so they sit under the main
 * button rather than beside it.
 */
function SecondaryActions({
  request,
  propertyId,
  permissions,
  action,
}: {
  request: RequestDetail;
  propertyId: string;
  permissions: BoardPermissions;
  action: (formData: FormData) => void;
}) {
  // Handing it back: only on a request that IS assigned and not yet started —
  // after that it is a completion or a rejection.
  const putBack = request.status === 'ASSIGNED' && permissions.assign;
  // Refusing: the guest reads the reason, so it sits behind a tap instead of a
  // text box on every card.
  const refuse = permissions.advance && request.status !== 'COMPLETED';
  if (!putBack && !refuse) return null;

  return (
    <div className={styles.secondaryRow}>
      {putBack ? (
        <form action={action} className={styles.actionForm}>
          <input type="hidden" name="propertyId" value={propertyId} />
          <input type="hidden" name="requestId" value={request.id} />
          <input type="hidden" name="to" value="OPEN" />
          <MoveButton label="Put it back" kind="quiet" />
        </form>
      ) : null}
      {refuse ? (
        <details className={styles.cannot}>
          <summary>Cannot do it</summary>
          <form action={action} className={styles.cannotForm}>
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
            <MoveButton label="Tell them" kind="secondary" />
          </form>
        </details>
      ) : null}
    </div>
  );
}

function MoveButton({ label, kind }: { label: string; kind: 'primary' | 'secondary' | 'quiet' }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles[kind]} disabled={pending}>
      {pending ? '…' : label}
    </button>
  );
}

/** "2 × Extra towels, Iron and board" — the request as one line. */
function whatLine(request: RequestDetail): string {
  return request.lines
    .map((line) => (line.quantity > 1 ? `${line.quantity} × ${line.label}` : line.label))
    .join(', ');
}

/** "Sunita Devi" → "Sunita": the board's one-line rows name people as a floor does. */
function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
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
    heat: late ? 'late' : used >= 0.75 ? 'soon' : 'ok',
    minutes: Math.max(0, Math.round(Math.abs(seconds) / 60)),
  } as const;
}

/**
 * One clock for the whole board, on a 20-second tick: a request nobody touches
 * still gets closer to breaching, and this board's job is to show that before
 * it happens.
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
