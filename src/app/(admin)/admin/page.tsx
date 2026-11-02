import Link from 'next/link';
import {
  AlarmClock, ArrowDown, ArrowRight, ArrowUp, Check, CircleSlash, Download, IndianRupee,
  LogOut, Minus, TriangleAlert, UtensilsCrossed, type LucideIcon,
} from 'lucide-react';
import { parseReportRange, REPORT_RANGES, type ReportRange } from '@/lib/report-window';
import { adminAccess, AdminDenied } from './guard';
import { LiveConsole } from './live-console';
import { loadOverview } from './overview/load';
import {
  buildChart, buildKpis, buildMovements, buildNeeds, timeOf,
  type Kpi, type NeedIcon,
} from './overview/model';
import { sparkPoints } from './overview/kpis';
import { PeriodChart } from './overview/period-chart';
import styles from './overview/overview.module.css';

/**
 * The console's front page — Direction A (design/reference/direction-a/
 * ConsoleOverview.dc.html): how the period is going, what needs somebody,
 * what is moving on the floor, and who is coming and going today.
 *
 * Today / 7 days / 30 days is a link (`?range=`), not client state, so the
 * choice survives a reload and can be sent to somebody. Every boundary is the
 * hotel's calendar, not the server's (`lib/report-window.ts`), and every KPI
 * is compared with the period before it — today with the same weekday last
 * week up to this time of day.
 *
 * Real data only. What each number is, exactly, is written beside the query
 * that makes it: revenue in `billing/revenue-rules.ts` and
 * `ordering/period-report.ts`, requests on time in
 * `requests/period-report.ts`, occupancy in `stay/period-report.ts`. The
 * board's "Room ready / Making up" for arrivals is not here: there is no
 * reservation date in this product, so an arrival is somebody already
 * checked in.
 *
 * Every block is skipped for an account that cannot open the screen behind
 * it (see `overview/load.ts`). Live, like the rest of the console (D-060): an
 * order or a request anywhere re-reads this page.
 */
export const dynamic = 'force-dynamic';

const RANGE_LABEL: Record<ReportRange, string> = { today: 'Today', '7d': '7 days', '30d': '30 days' };

const NEED_ICON: Record<NeedIcon, LucideIcon> = {
  late: AlarmClock,
  checkout: LogOut,
  owing: IndianRupee,
  portions: UtensilsCrossed,
  off: CircleSlash,
};

export default async function AdminHome({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[] }>;
}) {
  // No permission is needed to see the console's front page: it shows what
  // this account can reach, and an account that can reach nothing is told so.
  const access = await adminAccess();
  if (!access.ok) return <AdminDenied reason={access.reason} />;
  const { session, propertyId } = access;
  const range = parseReportRange((await searchParams).range);

  const data = await loadOverview(session, propertyId, range);
  const { may, timeZone, now, at } = data;

  const kpis = buildKpis(data);
  const chart = buildChart(data);
  const needs = buildNeeds(data);
  const movements = buildMovements(data);
  const late = data.openRequests.filter((r) => r.breached).length;

  const hour = Math.floor(at.minutes / 60);
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = session.fullName.trim().split(/\s+/)[0] ?? '';
  const dateLine = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone,
  }).format(now);
  const inHouse = data.rooms.filter((r) => r.stay).length;
  const context = [
    may.stays ? `${inHouse} ${inHouse === 1 ? 'room' : 'rooms'} in house` : null,
    data.kitchenLine ?? (may.orders ? 'no in-room dining outlet' : null),
  ].filter(Boolean).join(', ');

  const stage = (...statuses: string[]) => data.tickets.filter((t) => statuses.includes(t.status)).length;
  const pastPromise = data.tickets.filter((t) => t.promisedByAt && t.promisedByAt < now).length;
  const arrivals = data.arrivals.length;
  const leaving = data.departures.due.length + data.departures.left.length;

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.hello}>
          <h1 className={styles.greeting}>{firstName ? `${greeting}, ${firstName}` : greeting}</h1>
          <p className={styles.dateLine}>
            {dateLine} · <span className="tabular">{timeOf(now, timeZone)}</span>
            {context ? ` · ${context}` : null}
          </p>
        </div>
        <div className={styles.controls}>
          <LiveConsole propertyId={propertyId} orders={may.orders} requests={may.requests} />
          {kpis.length || chart ? (
            <>
              <div role="group" aria-label="Period" className={styles.segment}>
                {REPORT_RANGES.map((r) => (
                  <Link
                    key={r}
                    href={r === 'today' ? '/admin' : `/admin?range=${r}`}
                    className={styles.segmentLink}
                    aria-current={r === range ? 'page' : undefined}
                    scroll={false}
                  >
                    {RANGE_LABEL[r]}
                  </Link>
                ))}
              </div>
              <a href={`/admin/overview/export?range=${range}`} className={styles.button} download>
                <Download size={16} strokeWidth={1.75} aria-hidden="true" />
                Export
              </a>
            </>
          ) : null}
        </div>
      </header>

      {kpis.length ? (
        <section aria-label={`${RANGE_LABEL[range]}: the numbers`} className={styles.kpis}>
          {kpis.map((kpi) => <KpiTile key={kpi.key} kpi={kpi} />)}
        </section>
      ) : null}

      <div className={styles.row}>
        {chart ? (
          <section className={`${styles.card} ${styles.wide}`} aria-labelledby="chart-title">
            <div className={styles.cardHead}>
              <div className={styles.cardTitles}>
                <h2 id="chart-title" className={styles.cardTitle}>{chart.title}</h2>
                <span className={styles.cardBlurb}>{chart.blurb}</span>
              </div>
              <span className={`${styles.cardFigure} tabular`}>{chart.total}</span>
            </div>
            <PeriodChart
              unit={chart.unit}
              currency={data.currency}
              values={chart.values}
              previous={chart.previous}
              labels={chart.labels}
              titles={chart.titles}
              upto={chart.upto}
              hourly={data.window.bucket === 'hour'}
              currentName={range === 'today' ? 'Today' : `The last ${data.window.days} days`}
              previousName={chart.previousName}
              previousEach={chart.previousEach}
            />
            {data.orders?.topDishes.length ? (
              <p className={styles.chartFoot}>
                Most ordered:{' '}
                {data.orders.topDishes.map((d, i) => (
                  <span key={d.name}>
                    {i ? ' · ' : ''}{d.name} <span className="tabular">×{d.quantity}</span>
                  </span>
                ))}
              </p>
            ) : null}
          </section>
        ) : null}

        {/* Only for an account that can see what it lists, and the empty
            sentence claims only what this account can see: "requests are
            inside their promise" said to the kitchen, which cannot see
            requests, would be a claim it has no grounds for. */}
        {may.requests || may.stays || may.menu ? (
          <section className={`${styles.card} ${styles.narrow}`} aria-labelledby="needs-title">
            <div className={styles.cardHead}>
              <h2 id="needs-title" className={styles.cardTitle}>Needs you</h2>
              {late ? (
                <span className={styles.pill} data-tone="crit">
                  <TriangleAlert size={12} strokeWidth={2} aria-hidden="true" />
                  <span className="tabular">{late}</span> late
                </span>
              ) : null}
            </div>
            {needs.length ? (
              <ul className={styles.needs}>
                {needs.slice(0, 6).map((need) => {
                  const Icon = NEED_ICON[need.icon];
                  return (
                    <li key={need.key} className={styles.need}>
                      <span className={styles.needIcon} data-tone={need.tone}>
                        <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                      </span>
                      <span className={styles.needBody}>
                        <span className={styles.needTitle}>{need.title}</span>
                        <span className={styles.needSub} data-alarm={need.subIsAlarm || undefined}>{need.sub}</span>
                      </span>
                      <Link
                        href={need.href}
                        className={need.primary ? styles.actionPrimary : styles.action}
                        aria-label={`${need.action}: ${need.title}`}
                      >
                        {need.action}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className={styles.empty}>
                Nothing is waiting on anybody.
                {may.requests ? ' Requests are inside their promise.' : ''}
                {may.stays ? ' No one has asked to leave later.' : ''}
              </p>
            )}
            {needs.length > 6 ? (
              <p className={styles.more}>
                <span className="tabular">{needs.length - 6}</span> more —{' '}
                <Link href="/admin/requests">Requests</Link> · <Link href="/admin/checkouts">Leaving</Link>
              </p>
            ) : null}
          </section>
        ) : null}
      </div>

      <div className={styles.row}>
        {may.orders ? (
          <section className={`${styles.card} ${styles.narrow} ${styles.padded}`} aria-labelledby="floor-title">
            <div className={styles.cardHeadFlat}>
              <h2 id="floor-title" className={styles.cardTitle}>Live floor</h2>
              <Link href="/admin/floor" className={styles.cardLink}>
                Open board <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
              </Link>
            </div>
            <ul className={styles.stages}>
              <Stage label="New" n={stage('PLACED')} />
              <Stage label="Cooking" n={stage('ACCEPTED', 'PREPARING')} />
              <Stage label="At the pass" n={stage('READY')} />
              <Stage label="On the way" n={stage('OUT_FOR_DELIVERY')} />
            </ul>
            {data.tickets.length === 0 ? (
              <p className={styles.floorNote}>Nothing on the rail. The kitchen is clear.</p>
            ) : pastPromise ? (
              <p className={styles.floorNote} data-tone="crit">
                <TriangleAlert size={14} strokeWidth={2} aria-hidden="true" />
                <span className="tabular">{pastPromise}</span>
                {pastPromise === 1 ? ' order is' : ' orders are'} past the time promised
              </p>
            ) : (
              <p className={styles.floorNote} data-tone="pos">
                <Check size={14} strokeWidth={2.5} aria-hidden="true" />
                Every order inside its promised time
              </p>
            )}
          </section>
        ) : null}

        {may.stays ? (
          <section className={`${styles.card} ${styles.wide}`} aria-labelledby="moves-title">
            <div className={styles.cardHead}>
              <h2 id="moves-title" className={styles.cardTitle}>Arriving &amp; leaving</h2>
              <span className={styles.cardBlurb}>
                <span className="tabular">{arrivals}</span> in · <span className="tabular">{leaving}</span> out today
              </span>
            </div>
            {movements.length ? (
              <div className={styles.tableBox}>
                <table className={styles.moves}>
                  <thead>
                    <tr>
                      <th scope="col">Room</th>
                      <th scope="col">Guest</th>
                      <th scope="col">When</th>
                      <th scope="col" className={styles.end}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((m) => (
                      <tr key={m.key}>
                        <td className="tabular">{m.room}</td>
                        <td>{m.guest}{m.vip ? <span className={styles.vip}>VIP</span> : null}</td>
                        <td className={`${styles.when} tabular`}>{m.when}</td>
                        <td className={styles.end}>
                          <span className={styles.pill} data-tone={m.tone}>
                            {m.status}
                            {m.amount ? <span className="tabular">{m.amount}</span> : null}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={styles.empty}>Nobody has arrived or is due out today.</p>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}

function KpiTile({ kpi }: { kpi: Kpi }) {
  const { direction, text } = kpi.delta;
  const Arrow = direction === 'up' ? ArrowUp : direction === 'down' ? ArrowDown : Minus;
  const spoken = direction === 'none'
    ? 'nothing to compare with'
    : `${direction === 'flat' ? 'level' : direction} ${text} ${kpi.against}`;
  return (
    <Link href={kpi.href} className={styles.kpi}>
      <span className={styles.kpiTop}>
        <span className={styles.kpiLabel}>{kpi.label}</span>
        {direction !== 'none' ? (
          <span className={styles.pill} data-tone={direction} title={kpi.against}>
            <Arrow size={12} strokeWidth={2.25} aria-hidden="true" />
            <span className="tabular" aria-hidden="true">{text}</span>
            <span className={styles.srOnly}>{spoken}</span>
          </span>
        ) : null}
      </span>
      <span className={styles.kpiMiddle}>
        <span className={`${styles.kpiValue} tabular`}>{kpi.value}</span>
        {kpi.spark.length > 1 ? (
          <svg className={styles.spark} viewBox="0 0 96 32" preserveAspectRatio="none" aria-hidden="true">
            <polyline points={sparkPoints(kpi.spark, 96, 32)} vectorEffect="non-scaling-stroke" />
          </svg>
        ) : null}
      </span>
      <span className={styles.kpiNote}>{kpi.note}</span>
    </Link>
  );
}

function Stage({ label, n }: { label: string; n: number }) {
  return (
    <li className={styles.stage} data-empty={n === 0 || undefined}>
      <span className={`${styles.stageCount} tabular`}>{n}</span>
      <span className={styles.stageLabel}>{label}</span>
    </li>
  );
}
