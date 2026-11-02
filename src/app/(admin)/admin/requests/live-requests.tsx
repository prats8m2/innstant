'use client';

import Link from 'next/link';
import { useActionState, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Search } from 'lucide-react';
import { actOnRequest, type LiveRequestState } from './live-actions';
import styles from '../admin.module.css';
import s from '../staff/staff.module.css';
import q from './requests.module.css';

/**
 * The console's live view of guest requests (D-094).
 *
 * The Housekeeping board is the tool for the person walking the corridor; this
 * is the view from the office: every request still open on every floor, which
 * are late, which nobody has, and what was finished today — and the one thing
 * the board cannot do, which is choose WHO takes one.
 *
 * Every string arrives formatted from the server (#5); the list filters
 * locally, because every open request is already on the page.
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
  /** "14:02" — when the guest asked. */
  askedAt: string;
  /** "8m left" / "12m over" while the clock runs; null after. */
  sla: string | null;
  late: boolean;
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
  /** "on shift · Second, Rooftop", or empty for somebody not clocked in. */
  note: string;
}

type Filter = 'open' | 'late' | 'nobody' | 'check' | 'done';

export function LiveRequests({
  open,
  closed,
  floors,
  linkFor,
  selected,
}: {
  open: LiveRequestView[];
  closed: LiveRequestView[];
  floors: Array<{ id: string; name: string }>;
  /** A request's panel, by id. */
  linkFor: Record<string, string>;
  selected: string | null;
}) {
  const [filter, setFilter] = useState<Filter>('open');
  const [floor, setFloor] = useState('all');
  const [query, setQuery] = useState('');

  const live = open.filter((r) => r.status !== 'COMPLETED');
  const counts: Record<Filter, number> = {
    open: live.length,
    late: live.filter((r) => r.late).length,
    nobody: live.filter((r) => r.status === 'OPEN').length,
    check: open.filter((r) => r.status === 'COMPLETED').length,
    done: closed.length,
  };

  const rows = useMemo(() => {
    const base = filter === 'done' ? closed
      : filter === 'check' ? open.filter((r) => r.status === 'COMPLETED')
        : filter === 'late' ? live.filter((r) => r.late)
          : filter === 'nobody' ? live.filter((r) => r.status === 'OPEN')
            : live;
    const needle = query.trim().toLowerCase();
    return base.filter((r) => (floor === 'all' || r.floorId === floor)
      && (!needle || r.room.toLowerCase().startsWith(needle) || r.what.toLowerCase().includes(needle)
        || r.number.toLowerCase().includes(needle) || (r.assignee ?? '').toLowerCase().includes(needle)));
  }, [filter, floor, query, open, closed, live]);

  const FILTERS: Array<{ key: Filter; label: string }> = [
    { key: 'open', label: 'Open' },
    { key: 'late', label: 'Late' },
    { key: 'nobody', label: 'Nobody has it' },
    { key: 'check', label: 'Done, not checked' },
    { key: 'done', label: 'Finished today' },
  ];

  return (
    <section className={`${styles.section} ${q.list}`} aria-label="Requests">
      <div className={s.toolbar}>
        <label className={s.search}>
          <Search size={16} className={s.searchIcon} aria-hidden="true" />
          <input
            type="search"
            className={s.searchInput}
            placeholder="Room, request, SR number or person"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Find a request"
          />
        </label>
        {floors.length > 1 ? (
          <select
            className={s.roleFilter}
            value={floor}
            onChange={(event) => setFloor(event.target.value)}
            aria-label="Floor"
          >
            <option value="all">Every floor</option>
            {floors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        ) : null}
        <div className={s.segments} role="group" aria-label="Which requests">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={s.segment}
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              data-tone={f.key === 'late' && counts.late ? 'critical' : undefined}
            >
              {f.label} <span className={`${s.segmentCount} tabular`}>{counts[f.key]}</span>
            </button>
          ))}
        </div>
      </div>

      {rows.length ? (
        <ul className={q.rows}>
          {rows.map((r) => (
            <li key={r.id} data-request={r.number} data-status={r.status} data-late={r.late}>
              <Link href={linkFor[r.id]!} scroll={false} className={q.row} aria-current={r.id === selected ? 'true' : undefined}>
                <span className={q.where}>
                  <span className={`${q.room} tabular`}>{r.room}</span>
                  <span className={q.floor}>{r.floorName}</span>
                </span>
                <span className={q.what}>
                  <span className={q.whatText}>{r.what}</span>
                  <span className={`${q.number} tabular`}>{r.number} · asked {r.askedAt}</span>
                </span>
                <span className={q.who}>{r.assignee ?? <em className={q.nobody}>Nobody yet</em>}</span>
                <span className={q.state}>
                  <span className={s.badge} data-tone={toneOf(r)}>{r.statusLabel}</span>
                </span>
                <span className={`${q.clock} tabular`} data-late={r.late}>
                  {r.sla ?? r.closedAt ?? ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.sectionEmpty}>
          {filter === 'open' && !query && floor === 'all'
            ? 'Nothing open on any floor. A request appears here the moment a guest asks.'
            : 'No requests match.'}
        </p>
      )}
    </section>
  );
}

function toneOf(r: LiveRequestView): 'positive' | 'attention' | 'critical' | undefined {
  if (r.late || r.status === 'REJECTED') return 'critical';
  if (r.status === 'OPEN' || r.status === 'COMPLETED') return 'attention';
  if (r.status === 'VERIFIED' || r.status === 'IN_PROGRESS') return 'positive';
  return undefined;
}

/**
 * One request, and what can be done to it, inside the console's `SidePanel`.
 */
export function RequestPanel({
  propertyId,
  request,
  staff,
  permissions,
}: {
  propertyId: string;
  request: LiveRequestView;
  staff: AssignableStaff[];
  permissions: { assign: boolean; advance: boolean; verify: boolean; cancel: boolean };
}) {
  const live = request.status === 'OPEN' || request.status === 'ASSIGNED' || request.status === 'IN_PROGRESS';

  return (
    <div className={s.panel} data-request-panel={request.number}>
      <section className={s.panelSection}>
        <dl className={s.facts}>
          <dt>Room</dt><dd className="tabular">{request.room} · {request.floorName}</dd>
          <dt>Asked for</dt><dd>{request.what}</dd>
          {request.charge ? (<><dt>Charge</dt><dd className="tabular">{request.charge}</dd></>) : null}
          <dt>Asked at</dt><dd className="tabular">{request.askedAt}</dd>
          <dt>State</dt>
          <dd>
            <span className={s.badge} data-tone={toneOf(request)}>{request.statusLabel}</span>
            {request.escalated ? <span className={q.escalated}> · a manager has been told</span> : null}
          </dd>
          {request.sla ? (<><dt>Promise</dt><dd className="tabular" data-late={request.late}>{request.sla}</dd></>) : null}
          <dt>With</dt><dd>{request.assignee ?? 'Nobody yet'}</dd>
          {request.closedAt ? (<><dt>Finished</dt><dd className="tabular">{request.closedAt}{request.minutesToDone !== null ? ` · ${request.minutesToDone} min after asking` : ''}</dd></>) : null}
          {request.reason ? (<><dt>Told the guest</dt><dd>&ldquo;{request.reason}&rdquo;</dd></>) : null}
        </dl>
        {request.note ? <p className={q.note}>&ldquo;{request.note}&rdquo;</p> : null}
      </section>

      {live && permissions.assign && request.status !== 'IN_PROGRESS' ? (
        <section className={s.panelSection}>
          <h3 className={s.panelTitle}>{request.status === 'ASSIGNED' ? 'Give it to someone else' : 'Give it to someone'}</h3>
          <Assign propertyId={propertyId} request={request} staff={staff} />
        </section>
      ) : null}

      {(request.status === 'ASSIGNED' && (permissions.assign || permissions.advance))
        || (request.status === 'IN_PROGRESS' && permissions.advance)
        || (request.status === 'COMPLETED' && permissions.verify) ? (
          <section className={s.panelSection}>
            <h3 className={s.panelTitle}>Move it on</h3>
            <div className={s.formRow}>
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
        <section className={s.panelSection} data-danger="true">
          <h3 className={s.panelTitle}>Close it without doing it</h3>
          <Close propertyId={propertyId} request={request} permissions={permissions} />
        </section>
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
  return (
    <form action={action} className={s.panelForm}>
      <Hidden propertyId={propertyId} request={request} />
      <input type="hidden" name="act" value="assign" />
      <label className={styles.field}>
        <span className={styles.label}>Who</span>
        <select name="staffId" className={styles.input} required defaultValue="">
          <option value="" disabled>Choose a person</option>
          {staff.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}{person.note ? ` — ${person.note}` : ''}
            </option>
          ))}
        </select>
        <span className={styles.hint}>People on shift come first. It goes straight to their phone.</span>
      </label>
      <Feedback state={state} />
      <div className={s.formRow}><Submit label="Assign" primary /></div>
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
    <form action={action} className={s.panelForm}>
      <Hidden propertyId={propertyId} request={request} />
      <label className={styles.field}>
        <span className={styles.label}>Why</span>
        <input name="reason" className={styles.input} maxLength={200} required placeholder="The guest reads this" />
      </label>
      <Feedback state={state} />
      <div className={s.formRow}>
        {permissions.advance ? <Submit label="It cannot be done" name="act" value="reject" /> : null}
        {permissions.cancel ? <Submit label="Cancel it" name="act" value="cancel" /> : null}
      </div>
    </form>
  );
}

function Feedback({ state }: { state: LiveRequestState }) {
  if (state.error) return <p className={styles.inlineError} role="alert">{state.error}</p>;
  if (state.done) return <p className={styles.inlineDone}>{state.done}</p>;
  return null;
}

function Submit({ label, primary = false, name, value }: { label: string; primary?: boolean; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} className={primary ? styles.primary : styles.secondary} disabled={pending}>
      {pending ? '…' : label}
    </button>
  );
}
