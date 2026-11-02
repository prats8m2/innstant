'use client';

import Link from 'next/link';
import { initials } from '@/lib/initials';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Clock, PhoneCall, UserCheck, UserX, X } from 'lucide-react';
import { actOnRequest, raiseForPhonedGuest, type LiveRequestState } from './live-actions';
import q from './requests.module.css';

/**
 * The console's live view of guest requests (D-094), to Direction A's
 * Requests board (design/reference/direction-a/ConsoleRequests).
 *
 * The Housekeeping board is the tool for the person walking the corridor; this
 * is the view from the office: every request still open on every floor, which
 * are late, which nobody has, and what was finished today — and the one thing
 * the board cannot do, which is choose WHO takes one.
 *
 * The promise counts down on the screen. The server sends when each request
 * was asked for and when it was promised; this file works out "12 min left"
 * and "6 min over" from the clock, every fifteen seconds, so a request turns
 * late in front of the manager rather than at the next refresh. The first
 * render uses the server's clock, so the two agree on hydration.
 */
export type RequestPhase = 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'VERIFIED' | 'REJECTED' | 'CANCELLED';

export interface LiveRequestView {
  id: string;
  number: string;
  room: string;
  floorId: string;
  floorName: string;
  /** "2× Extra towels, 1× Slippers". */
  what: string;
  note: string | null;
  status: RequestPhase;
  statusLabel: string;
  assignee: string | null;
  assigneeId: string | null;
  /** Null with nobody assigned; false when they have since clocked out. */
  assigneeOnShift: boolean | null;
  /** The guest in the room, for somebody allowed to see stays; else null. */
  guestName: string | null;
  /** Raised by the desk for a guest who rang, or from the guest's phone. */
  source: 'phone' | 'app';
  /** "8:37pm" — when the guest asked. */
  askedAt: string;
  askedAtMs: number;
  /** The promise, while the clock runs: open, assigned or on the way. */
  slaTargetMs: number | null;
  /** "8:52pm". */
  promisedAt: string | null;
  escalated: boolean;
  /** "₹450", or null when it is free. */
  charge: string | null;
  /** When it was finished with, for the done-today list. */
  closedAt: string | null;
  /** Why it was refused or cancelled — what the guest was told. */
  reason: string | null;
  /** Minutes from asking to done, for a finished request. */
  minutesToDone: number | null;
}

export interface AssignableStaff {
  id: string;
  name: string;
  /** Clocked in right now — the only people a request can go to (D-098). */
  onShift: boolean;
  /** "Second, Rooftop" while on shift. */
  floors: string | null;
  /** The floors their shift covers — "Closest" is the request's floor among them. */
  floorIds: string[];
  /** Live requests they hold now. */
  holding: number;
}

/**
 * Beside a person's name: clocked in, or not (D-098). An icon AND words for
 * a screen reader — colour is never the only signal.
 */
export function ShiftMark({ onShift }: { onShift: boolean }) {
  return onShift ? (
    <span className={q.onShift} title="On shift">
      <UserCheck size={14} aria-hidden="true" /><span className={q.srOnly}>on shift</span>
    </span>
  ) : (
    <span className={q.offShift} title="Not clocked in">
      <UserX size={14} aria-hidden="true" /><span className={q.srOnly}>not clocked in</span>
    </span>
  );
}


/* ── The clock ───────────────────────────────────────────────────────────── */

export interface Sla {
  text: string;
  late: boolean;
  /** Minutes past the promise, when late. */
  lateBy: number;
  /** How much of the promised window has gone, 0–100. */
  used: number;
  tone: 'pos' | 'warn' | 'crit';
}

export function slaOf(r: LiveRequestView, now: number): Sla | null {
  if (r.slaTargetMs === null) return null;
  const seconds = (r.slaTargetMs - now) / 1000;
  const span = (r.slaTargetMs - r.askedAtMs) / 1000;
  const late = seconds < 0;
  const lateBy = late ? Math.max(1, Math.floor(-seconds / 60)) : 0;
  const used = span > 0 ? Math.min(100, Math.max(0, (1 - seconds / span) * 100)) : 100;
  return {
    text: late ? `${lateBy} min over` : `${Math.max(1, Math.ceil(seconds / 60))} min left`,
    late,
    lateBy,
    used,
    tone: late ? 'crit' : used > 60 ? 'warn' : 'pos',
  };
}

function useNow(serverNow: number): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/* ── The list ────────────────────────────────────────────────────────────── */

type Filter = 'open' | 'late' | 'nobody' | 'check' | 'done';
type Group = 'none' | 'floor' | 'person';

const FILTERS: Array<{ key: Filter; label: string; tone?: 'crit' | 'warn' }> = [
  { key: 'open', label: 'Open' },
  { key: 'late', label: 'Late', tone: 'crit' },
  { key: 'nobody', label: 'Nobody has it', tone: 'warn' },
  { key: 'check', label: 'Done, not checked' },
  { key: 'done', label: 'Done today' },
];

export function LiveRequests({
  open,
  closed,
  floors,
  selected,
  serverNow,
}: {
  open: LiveRequestView[];
  closed: LiveRequestView[];
  floors: Array<{ id: string; name: string }>;
  selected: string | null;
  serverNow: number;
}) {
  const router = useRouter();
  const now = useNow(serverNow);
  const [filter, setFilter] = useState<Filter>('open');
  const [floor, setFloor] = useState('all');
  const [group, setGroup] = useState<Group>('none');

  const live = open.filter((r) => r.status !== 'COMPLETED');
  const isLate = (r: LiveRequestView) => slaOf(r, now)?.late ?? false;
  const counts: Record<Filter, number> = {
    open: live.length,
    late: live.filter(isLate).length,
    nobody: live.filter((r) => r.status === 'OPEN').length,
    check: open.filter((r) => r.status === 'COMPLETED').length,
    done: closed.length,
  };

  const rows = useMemo(() => {
    const base = filter === 'done' ? closed
      : filter === 'check' ? open.filter((r) => r.status === 'COMPLETED')
        : filter === 'late' ? live.filter((r) => slaOf(r, now)?.late)
          : filter === 'nobody' ? live.filter((r) => r.status === 'OPEN')
            : live;
    return base.filter((r) => floor === 'all' || r.floorId === floor);
  }, [filter, floor, open, closed, live, now]);

  const groups = useMemo(() => {
    if (group === 'none') return [{ key: 'all', label: null as string | null, rows }];
    const keyOf = (r: LiveRequestView) => (group === 'floor' ? r.floorName : r.assignee ?? 'Nobody yet');
    const labels = [...new Set(rows.map(keyOf))];
    return labels.map((label) => ({ key: label, label, rows: rows.filter((r) => keyOf(r) === label) }));
  }, [group, rows]);

  const href = (r: LiveRequestView) => `/admin/requests?request=${r.id}`;

  return (
    <section className={q.listWrap} aria-label="Requests">
      <div className={q.filterBar}>
        <div role="tablist" aria-label="Which requests" className={q.filterTabs}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              className={q.filterTab}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              <span className={`${q.count} tabular`} data-tone={counts[f.key] ? f.tone : undefined}>{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <div className={q.filterTools}>
          {floors.length > 1 ? (
            <label className={q.selectWrap}>
              <span className={q.srOnly}>Floor</span>
              <select className={q.select} value={floor} onChange={(event) => setFloor(event.target.value)}>
                <option value="all">Floor: all</option>
                {floors.map((f) => <option key={f.id} value={f.id}>Floor: {f.name}</option>)}
              </select>
            </label>
          ) : null}
          <label className={q.selectWrap}>
            <span className={q.srOnly}>Group</span>
            <select className={q.select} value={group} onChange={(event) => setGroup(event.target.value as Group)}>
              <option value="none">Group: none</option>
              <option value="floor">Group: floor</option>
              <option value="person">Group: who has it</option>
            </select>
          </label>
        </div>
      </div>

      {rows.length ? (
        <div className={q.tableCard}>
          <table className={q.table}>
            <thead>
              <tr>
                <th className={q.lbl}>Request</th>
                <th className={q.lbl}>Who has it</th>
                <th className={`${q.lbl} ${q.slaCol}`}>{filter === 'done' ? 'Finished' : 'Time left'}</th>
                <th className={`${q.lbl} ${q.right}`}>Status</th>
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.key}>
                {g.label ? (
                  <tr className={q.groupRow}><th colSpan={4} scope="colgroup">{g.label} <span className="tabular">· {g.rows.length}</span></th></tr>
                ) : null}
                {g.rows.map((r) => {
                  const sla = slaOf(r, now);
                  return (
                    <tr
                      key={r.id}
                      className={q.row}
                      data-request={r.number}
                      data-status={r.status}
                      data-late={sla?.late ?? false}
                      aria-current={r.id === selected ? 'true' : undefined}
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest('a')) return;
                        router.push(href(r), { scroll: false });
                      }}
                    >
                      <td className={q.reqCell}>
                        <span className={`${q.room} tabular`}>{r.room}</span>
                        <span className={q.reqText}>
                          <Link href={href(r)} scroll={false} className={q.what}>{r.what}</Link>
                          <span className={q.src}>
                            {r.source === 'phone' ? 'Phoned the desk' : 'Guest app'} · <span className="tabular">{r.askedAt}</span>
                          </span>
                        </span>
                      </td>
                      <td className={q.whoCell}><Who r={r} /></td>
                      <td className={q.slaCell}>
                        {sla ? (
                          <span className={q.sla}>
                            <span className={`${q.slaText} tabular`} data-tone={sla.tone}>{sla.text}</span>
                            <span className={q.bar} role="img" aria-label={sla.text}>
                              <span className={q.barFill} data-tone={sla.tone} style={{ width: `${sla.used}%` }} />
                            </span>
                          </span>
                        ) : (
                          <span className={`${q.slaText} tabular`}>
                            {r.closedAt ?? ''}{r.minutesToDone !== null ? ` · ${r.minutesToDone} min` : ''}
                          </span>
                        )}
                      </td>
                      <td className={q.right}><StatusPill r={r} late={sla?.late ?? false} /></td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
      ) : (
        <p className={q.empty}>
          {filter === 'open' && floor === 'all'
            ? 'Nothing open on any floor. A request appears here the moment a guest asks.'
            : 'No requests match.'}
        </p>
      )}
    </section>
  );
}

function Who({ r }: { r: LiveRequestView }) {
  if (!r.assignee) {
    return (
      <span className={q.who} data-nobody="true">
        <span className={q.avatar} data-nobody="true" aria-hidden="true">?</span>Nobody yet
      </span>
    );
  }
  return (
    <span className={q.who}>
      <span className={q.avatar} aria-hidden="true">{initials(r.assignee)}</span>
      <span className={q.whoName}>{r.assignee}</span>
      {r.assigneeOnShift !== null ? <ShiftMark onShift={r.assigneeOnShift} /> : null}
      {r.assigneeOnShift === false && (r.status === 'ASSIGNED' || r.status === 'IN_PROGRESS')
        ? <span className={q.gone}>clocked out</span> : null}
    </span>
  );
}

function toneOf(r: LiveRequestView, late: boolean): 'pos' | 'warn' | 'crit' | 'info' | 'neutral' {
  if (late || r.status === 'REJECTED') return 'crit';
  if (r.status === 'OPEN' || r.status === 'COMPLETED') return 'warn';
  if (r.status === 'VERIFIED') return 'pos';
  if (r.status === 'ASSIGNED' || r.status === 'IN_PROGRESS') return 'info';
  return 'neutral';
}

function StatusPill({ r, late }: { r: LiveRequestView; late: boolean }) {
  return <span className={q.pill} data-tone={toneOf(r, late)}>{late ? 'Late' : r.statusLabel}</span>;
}

/* ── The right-hand column ───────────────────────────────────────────────── */

/**
 * The column beside the list, opened by the URL (`?request=…`, `?raise=1`)
 * like every console panel (D-061). On a desk it sits beside the list, as on
 * the board; under 1100px it covers the screen. Either way focus moves into
 * it and Escape closes it.
 */
export function Aside({ label, closeHref, children }: { label: string; closeHref: string; children: React.ReactNode }) {
  const router = useRouter();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    // Into the column without jumping the list: on a desk it sits beside it.
    ref.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') router.push(closeHref, { scroll: false });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [closeHref, router, label]);
  return (
    <aside ref={ref} tabIndex={-1} aria-label={label} className={q.aside}>
      <Link href={closeHref} scroll={false} className={q.close} aria-label="Close">
        <X size={18} aria-hidden="true" />
      </Link>
      {children}
    </aside>
  );
}

/**
 * One request, and what can be done to it.
 */
export function RequestPanel({
  propertyId,
  request,
  staff,
  permissions,
  serverNow,
}: {
  propertyId: string;
  request: LiveRequestView;
  staff: AssignableStaff[];
  permissions: { assign: boolean; advance: boolean; verify: boolean; cancel: boolean };
  serverNow: number;
}) {
  const now = useNow(serverNow);
  const sla = slaOf(request, now);
  const live = request.status === 'OPEN' || request.status === 'ASSIGNED' || request.status === 'IN_PROGRESS';

  return (
    <div className={q.panel} data-request-panel={request.number}>
      <header className={q.panelHead}>
        {sla ? (
          <span className={q.pill} data-tone={sla.tone === 'crit' ? 'crit' : sla.tone === 'warn' ? 'warn' : 'info'}>
            <Clock size={12} strokeWidth={2.5} aria-hidden="true" />
            {sla.late ? `Late ${sla.lateBy} min` : sla.text}
          </span>
        ) : (
          <span className={q.pill} data-tone={toneOf(request, false)}>{request.statusLabel}</span>
        )}
        <h2 className={q.panelTitle}>{request.what}</h2>
        <p className={q.panelSub}>
          Room <span className="tabular">{request.room}</span>
          {request.guestName ? <> · {request.guestName}</> : <> · {request.floorName}</>}
          {request.promisedAt ? <> · promised <span className="tabular">{request.promisedAt}</span></> : null}
        </p>
        <p className={q.panelMeta}>
          <span className="tabular">{request.number}</span> · {request.source === 'phone' ? 'phoned the desk' : 'from the guest app'} at{' '}
          <span className="tabular">{request.askedAt}</span>
          {request.charge ? <> · <span className="tabular">{request.charge}</span></> : null}
          {sla ? <> · {request.statusLabel}</> : null}
        </p>
        {request.escalated ? <p className={q.escalated}>A manager has been told it is late.</p> : null}
      </header>

      {request.note ? <p className={q.note}>&ldquo;{request.note}&rdquo;</p> : null}

      {request.assignee ? (
        <p className={q.withLine}>With <Who r={request} /></p>
      ) : null}
      {request.closedAt ? (
        <p className={q.withLine}>
          Finished <span className="tabular">{request.closedAt}</span>
          {request.minutesToDone !== null ? `, ${request.minutesToDone} min after asking` : ''}
        </p>
      ) : null}
      {request.reason ? <p className={q.withLine}>Told the guest: &ldquo;{request.reason}&rdquo;</p> : null}

      {/* Held by somebody who has since clocked out: it is on nobody's phone. */}
      {request.assigneeOnShift === false && request.status === 'ASSIGNED' ? (
        <p className={q.warnLine}>{request.assignee} has clocked out. Give it to somebody on shift.</p>
      ) : null}

      {live && permissions.assign && request.status !== 'IN_PROGRESS' ? (
        <Assign propertyId={propertyId} request={request} staff={staff} />
      ) : null}

      {(request.status === 'ASSIGNED' && (permissions.assign || permissions.advance))
        || (request.status === 'IN_PROGRESS' && permissions.advance)
        || (request.status === 'COMPLETED' && permissions.verify) ? (
          <section className={q.panelSection}>
            <h3 className={q.lbl}>Move it on</h3>
            <div className={q.actRow}>
              {request.status === 'ASSIGNED' && permissions.assign ? (
                <Act propertyId={propertyId} request={request} act="putBack" label="Put it back" />
              ) : null}
              {(request.status === 'ASSIGNED' || request.status === 'IN_PROGRESS') && permissions.advance ? (
                <Act propertyId={propertyId} request={request} act="done" label="Mark done" primary />
              ) : null}
              {request.status === 'COMPLETED' && permissions.verify ? (
                <Act propertyId={propertyId} request={request} act="verify" label="Checked" primary />
              ) : null}
            </div>
          </section>
        ) : null}

      {live && (permissions.advance || permissions.cancel) ? (
        <details className={q.closeBox}>
          <summary className={q.closeSummary}>Close it without doing it</summary>
          <Close propertyId={propertyId} request={request} permissions={permissions} />
        </details>
      ) : null}
    </div>
  );
}

function Hidden({ propertyId, request }: { propertyId: string; request: LiveRequestView }) {
  return (
    <>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="requestId" value={request.id} />
      <input type="hidden" name="from" value={request.status} />
    </>
  );
}

function Assign({ propertyId, request, staff }: { propertyId: string; request: LiveRequestView; staff: AssignableStaff[] }) {
  const [state, action] = useActionState<LiveRequestState, FormData>(actOnRequest, {});
  const covers = (p: AssignableStaff) => p.floorIds.includes(request.floorId);
  // Closest first: on shift AND covering the request's floor (D-098 is only
  // about being clocked in; this is only an order and a label).
  const onShift = staff
    .filter((p) => p.onShift && p.id !== request.assigneeId)
    .sort((a, b) => Number(covers(b)) - Number(covers(a)) || a.holding - b.holding || a.name.localeCompare(b.name));
  const off = staff.filter((p) => !p.onShift);
  const [chosen, setChosen] = useState<string | null>(null);
  const person = onShift.find((p) => p.id === chosen) ?? null;

  /**
   * Only people clocked in can be chosen (D-098) — the request system refuses
   * anybody else anyway. The rest are shown, greyed, so a manager looking for
   * somebody can see they are not on rather than wonder where they went.
   */
  return (
    <form action={action} className={q.panelSection}>
      <Hidden propertyId={propertyId} request={request} />
      <input type="hidden" name="act" value="assign" />
      <fieldset className={q.people}>
        <legend className={q.lbl}>{request.status === 'ASSIGNED' ? 'Give it to someone else' : 'Give it to'}</legend>
        {onShift.length === 0 ? (
          <p className={q.warnLine}>Nobody is clocked in. Somebody has to clock in on their phone before it can be given to them.</p>
        ) : null}
        {onShift.map((p) => (
          <label key={p.id} className={q.person} data-on-shift="true">
            <input type="radio" name="staffId" value={p.id} required onChange={() => setChosen(p.id)} />
            <span className={q.personAvatar} aria-hidden="true">{initials(p.name)}</span>
            <span className={q.personText}>
              <span className={q.personName}>{p.name} <ShiftMark onShift /></span>
              <span className={q.personShift}>
                On shift · {covers(p) ? request.floorName : p.floors}
                {' · '}<span className="tabular">{p.holding}</span> open
              </span>
            </span>
            {covers(p) ? <span className={q.closest}>Closest</span> : null}
          </label>
        ))}
        {off.map((p) => (
          <label key={p.id} className={q.person} data-on-shift="false">
            <input type="radio" name="staffId" value={p.id} disabled />
            <span className={q.personAvatar} aria-hidden="true">{initials(p.name)}</span>
            <span className={q.personText}>
              <span className={q.personName}>{p.name} <ShiftMark onShift={false} /></span>
              <span className={q.personShift}>Not clocked in</span>
            </span>
          </label>
        ))}
      </fieldset>
      <Feedback state={state} />
      {onShift.length ? (
        <>
          <Submit label={person ? `Assign to ${person.name.split(' ')[0]}` : 'Assign'} primary wide />
          {/* The guest's request screen, word for word: its ASSIGNED headline
              is the assignee's name and "is on the way". */}
          <p className={q.guestSees}>
            Guest will see: <b>&ldquo;{person ? `${person.name} is on the way` : 'Someone is on the way'}&rdquo;</b>
          </p>
        </>
      ) : null}
    </form>
  );
}

function Act({ propertyId, request, act, label, primary = false }: {
  propertyId: string; request: LiveRequestView; act: 'putBack' | 'done' | 'verify'; label: string; primary?: boolean;
}) {
  const [state, action] = useActionState<LiveRequestState, FormData>(actOnRequest, {});
  return (
    <form action={action} className={q.inline}>
      <Hidden propertyId={propertyId} request={request} />
      <input type="hidden" name="act" value={act} />
      <Submit label={label} primary={primary} />
      <Feedback state={state} />
    </form>
  );
}

function Close({ propertyId, request, permissions }: {
  propertyId: string; request: LiveRequestView; permissions: { advance: boolean; cancel: boolean };
}) {
  const [state, action] = useActionState<LiveRequestState, FormData>(actOnRequest, {});
  return (
    <form action={action} className={q.closeForm}>
      <Hidden propertyId={propertyId} request={request} />
      <label className={q.field}>
        <span className={q.fieldLabel}>Why</span>
        <input name="reason" className={q.input} maxLength={200} required placeholder="The guest reads this" />
      </label>
      <Feedback state={state} />
      <div className={q.actRow}>
        {permissions.advance ? <Submit label="It cannot be done" name="act" value="reject" /> : null}
        {permissions.cancel ? <Submit label="Cancel it" name="act" value="cancel" /> : null}
      </div>
    </form>
  );
}

/* ── Raise for a guest who phoned ────────────────────────────────────────── */

export interface RaiseRoom { id: string; number: string; guestName: string }
export interface RaiseType { id: string; label: string; allowsQuantity: boolean; maxQuantity: number }

export function RaiseForGuest({ propertyId, rooms, catalog, raiseKey }: {
  propertyId: string; rooms: RaiseRoom[]; catalog: RaiseType[]; raiseKey: string;
}) {
  const [state, action] = useActionState<LiveRequestState, FormData>(raiseForPhonedGuest, {});
  const [typeId, setTypeId] = useState('');
  const chosen = catalog.find((c) => c.id === typeId);
  return (
    <div className={q.panel}>
      <header className={q.panelHead}>
        <span className={q.pill} data-tone="info"><PhoneCall size={12} aria-hidden="true" />Taken by phone</span>
        <h2 className={q.panelTitle}>Raise for a guest who phoned</h2>
        <p className={q.panelSub}>It routes like any request and appears on the guest&rsquo;s phone, noted as taken by phone.</p>
      </header>
      {rooms.length === 0 ? (
        <p className={q.warnLine}>Nobody is checked in, so there is no room to raise it for.</p>
      ) : (
        <form action={action} className={q.panelSection}>
          <input type="hidden" name="propertyId" value={propertyId} />
          {/* Fresh after each one goes through, so a second request is a second
              request and a double tap is still one. */}
          <input type="hidden" name="idempotencyKey" value={state.done ? `${raiseKey.slice(0, 24)}${Date.now().toString(16).slice(-12).padStart(12, '0')}` : raiseKey} />
          <label className={q.field}>
            <span className={q.fieldLabel}>Room</span>
            <select name="roomId" className={q.input} defaultValue="" required>
              <option value="" disabled>Choose the room that rang</option>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.number} · {r.guestName}</option>)}
            </select>
          </label>
          <label className={q.field}>
            <span className={q.fieldLabel}>What they asked for</span>
            <select name="requestTypeId" className={q.input} value={typeId} onChange={(e) => setTypeId(e.target.value)} required>
              <option value="" disabled>Choose</option>
              {catalog.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          {chosen?.allowsQuantity ? (
            <label className={q.field}>
              <span className={q.fieldLabel}>How many</span>
              <input name="quantity" type="number" min={1} max={chosen.maxQuantity} defaultValue={1} className={q.input} />
            </label>
          ) : null}
          <label className={q.field}>
            <span className={q.fieldLabel}>Note</span>
            <input name="note" className={q.input} maxLength={300} placeholder="Leave them outside the door" />
          </label>
          <Feedback state={state} />
          <Submit label="Raise it" primary wide />
        </form>
      )}
    </div>
  );
}

function Feedback({ state }: { state: LiveRequestState }) {
  if (state.error) return <p className={q.error} role="alert">{state.error}</p>;
  if (state.done) return <p className={q.done}>{state.done}</p>;
  return null;
}

function Submit({ label, primary = false, wide = false, name, value }: {
  label: string; primary?: boolean; wide?: boolean; name?: string; value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      className={primary ? q.btnPrimary : q.btn}
      data-wide={wide || undefined}
      disabled={pending}
    >
      {pending ? '…' : label}
    </button>
  );
}
