'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, ArrowUpRight, Bike, BedDouble, ShoppingBag, UtensilsCrossed, type LucideIcon,
} from 'lucide-react';
import type { OrderStatus, StageTimes } from '@/modules/ordering';
import { useLiveRefresh } from '@/components/live-refresh';
import styles from '../admin.module.css';
import s from './floor.module.css';

export interface FloorTicket {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  destination: string;
  fulfilment: 'IN_ROOM' | 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
  items: number;
  placedAt: string | null;
  readyAt: string | null;
  promisedByAt: string | null;
  /** Who is carrying it, once picked up. */
  runner: string | null;
  allergy: boolean;
}

export interface FloorPerson {
  id: string;
  name: string;
  roles: string[];
  since: string | null;
  floors: string[];
}

type Heat = 'fresh' | 'soon' | 'late';

const LANES: ReadonlyArray<{
  key: string; title: string; statuses: readonly OrderStatus[];
  stage: keyof Omit<StageTimes, 'counts'>; stageLabel: string; empty: string;
}> = [
  { key: 'new', title: 'New', statuses: ['PLACED'], stage: 'toAccept', stageLabel: 'to accept', empty: 'Nothing waiting for the kitchen.' },
  { key: 'cooking', title: 'Cooking', statuses: ['ACCEPTED', 'PREPARING'], stage: 'inKitchen', stageLabel: 'in the kitchen', empty: 'Nothing on the fire.' },
  { key: 'pass', title: 'At the pass', statuses: ['READY'], stage: 'atPass', stageLabel: 'at the pass', empty: 'The pass is clear.' },
  { key: 'way', title: 'On the way', statuses: ['OUT_FOR_DELIVERY'], stage: 'toDoor', stageLabel: 'to the door', empty: 'Nobody is carrying anything.' },
];

const FULFILMENT_ICON: Record<FloorTicket['fulfilment'], LucideIcon> = {
  IN_ROOM: BedDouble,
  DINE_IN: UtensilsCrossed,
  TAKEAWAY: ShoppingBag,
  DELIVERY: Bike,
};

/**
 * The Live floor board (D-089). Read-only: every control for a ticket is on
 * the kitchen display or the runner's phone, where the person doing the work
 * is. This answers "is the floor all right, and where is it stuck?".
 */
export function FloorBoard({
  propertyId,
  propertyName,
  timeZone,
  tickets,
  stages,
  delivered,
  deliveredOnTime,
  people,
  requests,
  canOpenKds,
  renderedAt,
}: {
  /** The server's clock when it rendered: the first paint uses it, so server
   *  and browser agree on every age, then the board's own clock takes over. */
  renderedAt: number;
  propertyId: string;
  propertyName: string;
  timeZone: string;
  tickets: FloorTicket[];
  stages: StageTimes;
  delivered: number;
  deliveredOnTime: number;
  /** Null when this account cannot read shifts. */
  people: FloorPerson[] | null;
  requests: { open: number; late: number; unassigned: number } | null;
  canOpenKds: boolean;
}) {
  const now = useClock(renderedAt);
  const { connected } = useLiveRefresh({
    streamUrl: `/api/kds/stream?propertyId=${encodeURIComponent(propertyId)}`,
    eventName: 'order',
  });

  const late = tickets.filter((ticket) => heatOf(ticket, now) === 'late');
  const oldest = tickets
    .filter((ticket) => ticket.placedAt)
    .sort((a, b) => Date.parse(a.placedAt!) - Date.parse(b.placedAt!))[0];
  const oldestMinutes = oldest ? minutesSince(oldest.placedAt!, now) : null;

  const stageValues = LANES.map((lane) => stages[lane.stage]);
  const slowest = Math.max(0, ...stageValues.map((v) => v ?? 0));
  // "Slowest" only means something with at least two stages to compare.
  const comparable = stageValues.filter((v) => v != null).length >= 2;

  return (
    <>
      <header className={styles.pageHead}>
        <div>
          <h1 className={styles.title}>Live floor</h1>
          <p className={styles.lede}>
            {propertyName} · <span className="tabular">{clock(now, timeZone)}</span>
            <span className={s.live} data-connected={connected}>
              <span className={s.liveDot} aria-hidden="true" />
              {connected ? 'Live' : 'Reconnecting'}
            </span>
          </p>
        </div>
        {canOpenKds ? (
          <nav className={s.screens} aria-label="Floor screens">
            <a href="/kds" target="_blank" rel="noreferrer" className={styles.secondary}>
              Kitchen display <ArrowUpRight size={14} aria-hidden="true" />
            </a>
            <a href="/runner" target="_blank" rel="noreferrer" className={styles.secondary}>
              Runner <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </nav>
        ) : null}
      </header>

      <ul className={s.stats}>
        <Stat label="Open orders" value={tickets.length}
          sub={tickets.length ? LANES.map((lane) => `${tickets.filter((t) => lane.statuses.includes(t.status)).length} ${lane.title.toLowerCase()}`).join(' · ') : 'the floor is quiet'} />
        <Stat label="Running late" value={late.length} tone={late.length ? 'critical' : undefined}
          sub={late.length ? late.slice(0, 3).map((t) => t.destination).join(', ') : 'everything inside its promise'} />
        <Stat label="Oldest open" value={oldestMinutes == null ? '—' : `${oldestMinutes}m`}
          tone={oldest && heatOf(oldest, now) === 'late' ? 'critical' : undefined}
          sub={oldest ? `${oldest.destination} · ${oldest.orderNumber}` : 'nothing open'} />
        <Stat label="Delivered today" value={delivered}
          sub={delivered ? `${Math.round((deliveredOnTime / delivered) * 100)}% on time` : 'none yet'} />
        {requests ? (
          <Stat label="Requests open" value={requests.open} tone={requests.late ? 'critical' : undefined}
            sub={requests.open ? `${requests.late} late · ${requests.unassigned} with nobody` : 'nothing asked for'}
            href="/admin/requests" />
        ) : null}
      </ul>

      <section className={s.lanes} aria-label="Open orders by stage">
        {LANES.map((lane) => {
          const inLane = tickets.filter((ticket) => lane.statuses.includes(ticket.status));
          const average = stages[lane.stage];
          return (
            <div key={lane.key} className={s.lane}>
              <header className={s.laneHead}>
                <h2 className={s.laneTitle}>{lane.title}</h2>
                <span className={`${s.laneCount} tabular`}>{inLane.length}</span>
                <span className={s.laneHint}>
                  {average == null ? 'no average yet' : `avg ${average}m ${lane.stageLabel}`}
                </span>
              </header>
              {inLane.length ? (
                <ul className={s.cards}>
                  {inLane.map((ticket) => (
                    <TicketChip key={ticket.id} ticket={ticket} now={now} />
                  ))}
                </ul>
              ) : (
                <p className={s.laneEmpty}>{lane.empty}</p>
              )}
            </div>
          );
        })}
      </section>

      <div className={s.lower}>
        <section className={styles.section} aria-labelledby="stages-heading">
          <header className={styles.sectionHead}>
            <h2 id="stages-heading" className={styles.sectionTitle}>Where the time goes today</h2>
            <p className={styles.sectionBlurb}>Average minutes in each stage, for today&rsquo;s orders.</p>
          </header>
          <ul className={s.stageList}>
            {LANES.map((lane) => {
              const value = stages[lane.stage];
              const n = stages.counts[lane.stage];
              const isSlowest = comparable && value != null && value === slowest && slowest > 0;
              return (
                <li key={lane.key} className={s.stageRow} data-slowest={isSlowest}>
                  <span className={s.stageName}>{lane.stageLabel[0]!.toUpperCase() + lane.stageLabel.slice(1)}</span>
                  <span className={s.stageTrack} aria-hidden="true">
                    <span className={s.stageBar} style={{ width: `${value && slowest ? Math.max(4, (value / slowest) * 100) : 0}%` }} />
                  </span>
                  <span className={`${s.stageValue} tabular`}>{value == null ? '—' : `${value}m`}</span>
                  <span className={s.stageCount}>
                    {n ? `${n} ${n === 1 ? 'order' : 'orders'}` : 'none yet'}
                    {isSlowest ? ' · slowest' : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        {people ? (
          <section className={styles.section} aria-labelledby="shift-heading">
            <header className={styles.sectionHead}>
              <h2 id="shift-heading" className={styles.sectionTitle}>On shift</h2>
              <p className={styles.sectionBlurb}>Requests route only to people clocked in on that floor.</p>
            </header>
            {people.length ? (
              <ul className={s.people}>
                {people.map((person) => (
                  <li key={person.id} className={s.person}>
                    <span className={s.avatar} aria-hidden="true">
                      {person.name.split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase()}
                    </span>
                    <span className={s.personBody}>
                      <span className={s.personName}>{person.name}</span>
                      <span className={s.personMeta}>
                        {[person.roles.join(', '), person.floors.length ? person.floors.join(', ') : null]
                          .filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className={`${s.personSince} tabular`}>since {person.since ?? '—'}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={s.warning}>
                <AlertTriangle size={16} aria-hidden="true" />
                Nobody is clocked in. Requests wait until somebody notices them on a board.
              </p>
            )}
            <p className={s.sectionLink}><Link href="/admin/staff">Staff and shifts →</Link></p>
          </section>
        ) : null}
      </div>
    </>
  );
}

function Stat({
  label, value, sub, tone, href,
}: {
  label: string; value: number | string; sub: string; tone?: 'critical'; href?: string;
}) {
  const body = (
    <>
      <span className={s.statLabel}>{label}</span>
      <span className={`${s.statValue} tabular`}>{value}</span>
      <span className={s.statSub}>{sub}</span>
    </>
  );
  return (
    <li className={s.stat} data-tone={tone}>
      {href ? <Link href={href} className={s.statLink}>{body}</Link> : body}
    </li>
  );
}

function TicketChip({ ticket, now }: { ticket: FloorTicket; now: number }) {
  const heat = heatOf(ticket, now);
  const Icon = FULFILMENT_ICON[ticket.fulfilment];
  const from = ticket.status === 'READY' ? ticket.readyAt ?? ticket.placedAt : ticket.placedAt;
  const age = from ? minutesSince(from, now) : null;

  return (
    <li className={s.card} data-heat={heat}>
      <Icon className={s.cardIcon} size={16} strokeWidth={1.75} aria-hidden="true" />
      <span className={s.cardBody}>
        <span className={s.cardDest}>
          {ticket.destination}
          {ticket.allergy ? <span className={s.allergy} title="Allergy or diet note on this order">allergy</span> : null}
        </span>
        <span className={s.cardMeta}>
          {ticket.orderNumber} · {ticket.items} {ticket.items === 1 ? 'item' : 'items'}
          {ticket.runner ? ` · ${ticket.runner}` : ''}
        </span>
      </span>
      {age != null ? (
        <span className={`${s.age} tabular`} data-heat={heat}>
          {ticket.status === 'READY' ? `${age}m at pass` : `${age}m`}
        </span>
      ) : null}
    </li>
  );
}

/**
 * Against the PROMISE, not a fixed number of minutes — the same rule as the
 * kitchen display, so the two screens never disagree about what is late. At
 * the pass the clock is `ready_at`: food goes cold from when it was plated.
 */
function heatOf(ticket: FloorTicket, now: number): Heat {
  if (ticket.status === 'READY') {
    if (!ticket.readyAt) return 'fresh';
    const waiting = (now - Date.parse(ticket.readyAt)) / 60_000;
    return waiting > 10 ? 'late' : waiting > 5 ? 'soon' : 'fresh';
  }
  if (!ticket.placedAt || !ticket.promisedByAt) return 'fresh';
  const placed = Date.parse(ticket.placedAt);
  const promise = Date.parse(ticket.promisedByAt);
  if (promise <= placed) return 'fresh';
  if (now > promise) return 'late';
  return (now - placed) / (promise - placed) > 0.75 ? 'soon' : 'fresh';
}

function minutesSince(at: string, now: number): number {
  return Math.max(0, Math.round((now - Date.parse(at)) / 60_000));
}

/** One clock for the board; twenty seconds is fine enough for a minute count. */
function useClock(start: number): number {
  const [now, setNow] = useState(start);
  useEffect(() => {
    setNow(Date.now());
    const tick = window.setInterval(() => setNow(Date.now()), 20_000);
    return () => window.clearInterval(tick);
  }, []);
  return now;
}

function clock(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone,
  }).format(new Date(at));
}
