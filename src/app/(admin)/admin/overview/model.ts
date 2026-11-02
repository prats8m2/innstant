import { folioRevenueMinor } from '@/modules/billing';
import { effectiveFeeMinor } from '@/modules/stay';
import { formatCheckoutShort, nightsUntil } from '@/lib/clock';
import { formatMoney, money } from '@/lib/money';
import type { Overview } from './load';
import {
  addSeries, bucketLabel, bucketTitle, comparisonLabel, delta, occupancyPercent, percent,
  rateTrend, soFar, sum, trend, type Delta,
} from './kpis';

/**
 * The overview's data, shaped into what each block draws. Wording lives here
 * so the page is layout and the numbers are in one place.
 */

export interface Kpi {
  key: 'revenue' | 'orders' | 'requests' | 'occupancy';
  label: string;
  value: string;
  delta: Delta;
  /** "vs last Monday" — read with the pill by a screen reader. */
  against: string;
  note: string;
  spark: number[];
  href: string;
}

/** Whole rupees: a period's takings to the paisa is noise on a dashboard. */
export function rupeesOf(data: Overview) {
  return (minor: number) => formatMoney(money(minor, data.currency), { showDecimals: false });
}

/** "9:30pm" in the hotel's time. */
export function timeOf(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone,
  })
    .format(instant)
    .replace(/\s?([ap])m/i, (_, m: string) => `${m.toLowerCase()}m`);
}

/** Food & drink per bucket: orders' totals, less the desk's corrections to them. */
function foodSeries(data: Overview, which: 'current' | 'previous'): number[] | null {
  if (!data.orders) return null;
  const sales = data.orders[which].salesByBucket;
  if (!data.revenue) return sales;
  return addSeries(sales, data.revenue[which].byBucket.map((p) => p.foodCorrectionsMinor));
}

/** Revenue per bucket: orders' totals plus everything folios add (billing's
 *  rule, which already carries the corrections to food). */
function revenueSeries(data: Overview, which: 'current' | 'previous'): number[] | null {
  if (!data.orders || !data.revenue) return null;
  return addSeries(data.orders[which].salesByBucket, data.revenue[which].byBucket.map(folioRevenueMinor));
}

export function buildKpis(data: Overview): Kpi[] {
  const { window, upto } = data;
  const rupees = rupeesOf(data);
  const against = comparisonLabel(window, data.at.date!);
  const today = window.range === 'today';
  const kpis: Kpi[] = [];

  // ── Revenue ──────────────────────────────────────────────────────────────
  const revenue = revenueSeries(data, 'current');
  const food = foodSeries(data, 'current');
  if (data.may.sales && revenue && data.revenue) {
    const previous = revenueSeries(data, 'previous')!;
    const total = sum(revenue);
    const parts = data.revenue.current.total;
    const services = parts.servicesMinor + parts.creditsMinor;
    kpis.push({
      key: 'revenue',
      label: today ? 'Revenue today' : 'Revenue',
      value: rupees(total),
      delta: delta('relative', total, sum(previous)),
      against,
      note: [
        against,
        `rooms ${rupees(parts.roomsMinor)}`,
        `F&B ${rupees(sum(food!))}`,
        services ? `services ${rupees(services)}` : null,
      ].filter(Boolean).join(' · '),
      spark: trend(revenue, window.range, upto),
      href: '/admin/checkouts',
    });
  } else if (data.may.sales && food) {
    const total = sum(food);
    kpis.push({
      key: 'revenue',
      label: today ? 'Food & drink today' : 'Food & drink',
      value: rupees(total),
      delta: delta('relative', total, sum(foodSeries(data, 'previous')!)),
      against,
      note: `${against} · from orders`,
      spark: trend(food, window.range, upto),
      href: '/admin/menu',
    });
  }

  // ── Orders ───────────────────────────────────────────────────────────────
  if (data.orders) {
    const { current, previous, openNow } = data.orders;
    const count = sum(current.ordersByBucket);
    const delivered = sum(current.deliveredByBucket);
    const minutes = delivered ? Math.round(sum(current.minutesToDoorByBucket) / delivered) : null;
    kpis.push({
      key: 'orders',
      label: 'Orders',
      value: `${count}`,
      delta: delta('count', count, sum(previous.ordersByBucket)),
      against,
      note: [
        `${openNow} open`,
        minutes !== null ? `${minutes} min avg to the door` : 'nothing delivered yet',
      ].join(' · '),
      spark: trend(current.ordersByBucket, window.range, upto),
      href: '/kds',
    });
  }

  // ── Requests on time ─────────────────────────────────────────────────────
  if (data.requestsReport) {
    const { current, previous } = data.requestsReport;
    const finished = sum(current.finishedByBucket);
    const onTime = sum(current.onTimeByBucket);
    const rate = percent(onTime, finished);
    const late = data.openRequests.filter((r) => r.breached).length;
    kpis.push({
      key: 'requests',
      label: 'Requests on time',
      value: rate === null ? '—' : `${rate}%`,
      delta: delta('points', rate, percent(sum(previous.onTimeByBucket), sum(previous.finishedByBucket))),
      against,
      note: [
        finished ? `${onTime} of ${finished}` : 'nothing finished yet',
        late ? `${late} running late now` : null,
      ].filter(Boolean).join(' · '),
      spark: rateTrend(current.onTimeByBucket, current.finishedByBucket, window.range, upto),
      href: '/admin/requests',
    });
  }

  // ── Occupancy ────────────────────────────────────────────────────────────
  if (data.occupancy) {
    const rooms = data.rooms.length;
    const inHouse = data.rooms.filter((r) => r.stay).length;
    const rate = occupancyPercent(data.occupancy.current, window.range, upto, rooms);
    const leaving = data.departures.due.length + data.departures.left.length;
    kpis.push({
      key: 'occupancy',
      label: 'Occupancy',
      value: rate === null ? '—' : `${rate}%`,
      delta: delta('points', rate, occupancyPercent(data.occupancy.previous, window.range, upto, rooms)),
      against,
      note: today
        ? `${inHouse}/${rooms} in house · ${data.arrivals.length} arrived · ${leaving} leaving today`
        : `the average night · ${inHouse}/${rooms} in house now`,
      spark: soFar(data.occupancy.current, upto),
      href: '/admin/rooms?show=in',
    });
  }

  return kpis;
}

export interface Chart {
  /** Money or a count — a kitchen account sees how many, not how much. */
  unit: 'money' | 'count';
  title: string;
  blurb: string;
  total: string;
  values: number[];
  previous: number[];
  labels: string[];
  titles: string[];
  /** Buckets after this have not happened yet. */
  upto: number;
  previousName: string;
  previousEach: string;
}

export function buildChart(data: Overview): Chart | null {
  if (!data.orders) return null;
  const { window, upto } = data;
  const money = data.may.sales;
  const values = money ? foodSeries(data, 'current')! : data.orders.current.ordersByBucket;
  const previous = money ? foodSeries(data, 'previous')! : data.orders.previous.ordersByBucket;
  const per = window.bucket === 'hour' ? 'hour' : 'day';
  const span = window.range === 'today' ? 'today' : `the last ${window.days} days`;
  const total = sum(values);
  return {
    unit: money ? 'money' : 'count',
    title: money ? `Food & drink by ${per}` : `Orders by ${per}`,
    blurb: `Every outlet and table link, ${span}, in the hotel’s time`,
    total: money ? rupeesOf(data)(total) : `${total} ${total === 1 ? 'order' : 'orders'}`,
    values,
    previous,
    labels: values.map((_, i) => bucketLabel(window, i, data.at.date!)),
    titles: values.map((_, i) => bucketTitle(window, i, data.at.date!)),
    upto,
    previousName: window.range === 'today'
      ? comparisonLabel(window, data.at.date!).replace(/^vs last/, 'Last')
      : `The ${window.days} days before`,
    previousEach: window.range === 'today'
      ? comparisonLabel(window, data.at.date!).replace(/^vs /, '')
      : window.days === 7 ? 'a week earlier' : `${window.days} days earlier`,
  };
}

export type NeedTone = 'crit' | 'warn' | 'quiet';
export type NeedIcon = 'late' | 'checkout' | 'owing' | 'portions' | 'off';

export interface Need {
  key: string;
  tone: NeedTone;
  icon: NeedIcon;
  title: string;
  sub: string;
  /** The sub line is the alarm itself ("Late 6 min"), not context. */
  subIsAlarm: boolean;
  action: string;
  href: string;
  primary: boolean;
}

/** The things with a clock on them, most urgent first. */
export function buildNeeds(data: Overview): Need[] {
  const rupees = rupeesOf(data);
  const needs: Need[] = [];

  for (const r of data.openRequests.filter((x) => x.breached)) {
    const late = Math.max(1, Math.round(-(r.secondsRemaining ?? 0) / 60));
    const what = r.lines.map((l) => (l.quantity > 1 ? `${l.quantity} × ${l.label}` : l.label)).join(' + ');
    needs.push({
      key: `request-${r.id}`,
      tone: 'crit',
      icon: 'late',
      title: `${r.roomNumber} · ${what || r.requestNumber}`,
      sub: `Late ${late} min · ${r.assignedStaffName ? `${r.assignedStaffName} has it` : 'nobody has it'}`,
      subIsAlarm: true,
      action: !r.assignedStaffName && data.may.assign ? 'Assign' : 'Open',
      href: `/admin/requests?request=${r.id}`,
      primary: !r.assignedStaffName && data.may.assign,
    });
  }

  const vip = new Set(data.rooms.filter((r) => r.stay?.isVip).map((r) => r.stay!.id));
  for (const c of data.checkouts) {
    const fee = effectiveFeeMinor(c);
    needs.push({
      key: `checkout-${c.id}`,
      tone: 'warn',
      icon: 'checkout',
      title: `${c.roomNumber} · Late checkout to ${formatCheckoutShort(c.requestedCheckoutAt, data.timeZone)}`,
      sub: [c.guestName, vip.has(c.stayId) ? 'VIP' : null, fee ? rupees(fee) : 'no charge']
        .filter(Boolean).join(' · '),
      subIsAlarm: false,
      action: 'Review',
      href: '/admin/checkouts',
      primary: false,
    });
  }

  for (const u of data.unpaid.slice().reverse()) {
    needs.push({
      key: `owing-${u.stayId}`,
      tone: 'warn',
      icon: 'owing',
      title: `${u.roomNumber} · Left owing ${rupees(u.balanceMinor)}`,
      sub: [u.guestName, u.reason, formatCheckoutShort(u.checkedOutAt, data.timeZone)]
        .filter(Boolean).join(' · '),
      subIsAlarm: false,
      action: 'Open bill',
      href: `/admin/checkouts/${u.stayId}`,
      primary: false,
    });
  }

  for (const dish of data.dishes) {
    const p = data.portions.get(dish.id);
    if (!p || p.left > Math.max(2, Math.floor(p.limit / 4))) continue;
    needs.push({
      key: `portions-${dish.id}`,
      tone: 'quiet',
      icon: 'portions',
      title: p.left === 0 ? `${dish.name} · sold out` : `${dish.name} · ${p.left} left of ${p.limit}`,
      sub: p.left === 0 ? 'Guests see it as sold out today' : `Guests see “${p.left} left today”`,
      subIsAlarm: false,
      action: 'Raise limit',
      href: '/admin/menu',
      primary: false,
    });
  }

  if (data.unavailable.length) {
    const n = data.unavailable.length;
    needs.push({
      key: 'off',
      tone: 'quiet',
      icon: 'off',
      title: `${n} ${n === 1 ? 'dish' : 'dishes'} off tonight`,
      sub: data.unavailable.slice(0, 3).map((d) => d.name).join(', ') + (n > 3 ? '…' : ''),
      subIsAlarm: false,
      action: 'Menu',
      href: '/admin/menu',
      primary: false,
    });
  }

  return needs;
}

export interface Movement {
  key: string;
  room: string;
  guest: string;
  vip: boolean;
  at: Date;
  when: string;
  status: string;
  tone: 'pos' | 'warn' | 'crit' | 'quiet';
  /** A money figure inside the status, set in mono. */
  amount: string | null;
}

/** Today's arrivals and departures, in the order they happened (or will). */
export function buildMovements(data: Overview): Movement[] {
  const rupees = rupeesOf(data);
  const rows: Movement[] = [];

  for (const a of data.arrivals) {
    rows.push({
      key: `in-${a.stayId}`,
      room: a.roomNumber,
      guest: a.guestName,
      vip: a.isVip,
      at: a.checkedInAt,
      when: `${timeOf(a.checkedInAt, data.timeZone)} in`,
      status: a.status === 'CHECKED_IN' ? 'In house' : 'Left again',
      tone: a.status === 'CHECKED_IN' ? 'pos' : 'quiet',
      amount: null,
    });
  }

  for (const d of data.departures.due) {
    const overdue = d.scheduledCheckoutAt < data.now;
    rows.push({
      key: `due-${d.stayId}`,
      room: d.roomNumber,
      guest: d.guestName,
      vip: false,
      at: d.scheduledCheckoutAt,
      when: nightsUntil(data.now, d.scheduledCheckoutAt, data.timeZone) === 0
        ? `${timeOf(d.scheduledCheckoutAt, data.timeZone)} out`
        : `${formatCheckoutShort(d.scheduledCheckoutAt, data.timeZone)} out`,
      status: overdue ? 'Overdue' : 'Due out',
      tone: overdue ? 'warn' : 'quiet',
      amount: null,
    });
  }

  for (const d of data.departures.left) {
    const owing = data.may.folios && (d.balanceMinor ?? 0) > 0;
    rows.push({
      key: `left-${d.stayId}`,
      room: d.roomNumber,
      guest: d.guestName,
      vip: false,
      at: d.checkedOutAt ?? d.scheduledCheckoutAt,
      when: `${timeOf(d.checkedOutAt ?? d.scheduledCheckoutAt, data.timeZone)} out`,
      status: owing ? 'Left owing' : data.may.folios ? 'Settled' : 'Checked out',
      tone: owing ? 'crit' : 'quiet',
      amount: owing ? rupees(d.balanceMinor!) : null,
    });
  }

  return rows.sort((a, b) => a.at.getTime() - b.at.getTime());
}
