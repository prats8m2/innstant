import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { PhoneCall } from 'lucide-react';
import { withTenant } from '@/db';
import { adminAccess, AdminDenied } from '../guard';
import { can, findProperty, listFloors, listRolesAtProperty, listStaffAtProperty } from '@/modules/identity';
import {
  getAdminRequestTypes, getOpenRequests, getRequestsClosedToday, getRequestCatalog, type RequestDetail,
} from '@/modules/requests';
import { listOnShift } from '@/modules/housekeeping';
import { listRoomsWithOccupancy } from '@/modules/stay';
import { formatMoney, money } from '@/lib/money';
import { formatClock, localTimeAt, toClock } from '@/lib/clock';
import { RequestTypeEditor } from './request-type-editor';
import { TeamToday, TeamOnShift, type PersonLoad, type TypeLoad } from './team-today';
import {
  Aside, LiveRequests, RaiseForGuest, RequestPanel, type AssignableStaff, type LiveRequestView,
} from './live-requests';
import q from './requests.module.css';

/**
 * Guest requests: what is happening now (`Live`, the default, D-094), and what
 * a guest may ask for (`?tab=catalog`).
 *
 * The console had only the second, under the name "Requests", so a manager
 * looking for the request that was late had to walk over to a housekeeper's
 * phone. The live view is the office's: every open request, which are late,
 * which nobody has, and the one thing the floor board cannot do — choosing
 * who takes one.
 *
 * ─── The catalog ───────────────────────────────────────────────────────────
 *
 * What a guest may ask for, and what the hotel promises back.
 *
 * `request_types` has been the property-configurable catalog since S6 —
 * DATA-MODEL §7 says the ops team self-serves rather than filing a ticket with
 * us — and until this screen the only way to change "towels in 12 minutes" was
 * to edit `provision.ts` and re-run the seeder, which also wipes the property.
 *
 * Four columns on this screen are read by something that matters and by nothing
 * a manager could see: `sla_minutes` is what the SLA sweep escalates against,
 * `route_to_role_key` is what the auto-router matches on, `price_minor` is what
 * decides whether a guest meets the one verification prompt, and `is_active` is
 * what takes a thing off the guest's list for the season.
 */
export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<RequestDetail['status'], string> = {
  OPEN: 'Unassigned',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'On the way',
  COMPLETED: 'Done, not checked',
  VERIFIED: 'Checked',
  REJECTED: 'Refused',
  CANCELLED: 'Cancelled',
};

type Tab = 'live' | 'team' | 'catalog';

export default async function RequestsAdmin({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; request?: string; raise?: string }>;
}) {
  /**
   * `request:read` to look, `request_type:manage` to change the catalog — the
   * same split the menu editor makes with `catalog:read` and `catalog:manage`.
   * There is no `request_type:read`, and inventing one would be the wrong
   * shape: a housekeeper wondering why towels are twelve minutes should be
   * able to find out, and nothing here is a secret from somebody already
   * working the floor.
   */
  const access = await adminAccess('request:read');
  if (!access.ok) return <AdminDenied reason={access.reason} />;
  const { session, propertyId } = access;
  const params = await searchParams;
  const tab: Tab = params.tab === 'catalog' ? 'catalog' : params.tab === 'team' ? 'team' : 'live';

  const mayAssign = can(session, propertyId, 'request:assign');
  // Raising for a guest who rang is the desk acting on a stay (D-096).
  const mayRaise = can(session, propertyId, 'stay:update');
  // Who is in the room is the desk's to see, not every request reader's.
  const maySeeGuests = can(session, propertyId, 'stay:read');

  const data = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => {
      const property = await findProperty(tx, propertyId);
      const timeZone = property?.timezone ?? 'Asia/Kolkata';
      const open = await getOpenRequests(tx, {
        propertyId, statuses: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED'],
      });
      if (tab === 'catalog') {
        return {
          timeZone, open, closed: [] as RequestDetail[], floors: [], staff: [], onShift: [], occupancy: [], catalog: [],
          types: await getAdminRequestTypes(tx, { propertyId }),
          // With the headcount, so routing at a role nobody holds is visible
          // on the form rather than discovered as requests never assigned.
          roles: await listRolesAtProperty(tx, { propertyId }),
        };
      }
      return {
        timeZone,
        open,
        closed: await getRequestsClosedToday(tx, { propertyId, timeZone }),
        floors: await listFloors(tx, propertyId),
        // Everybody: the assign list, Team on shift and Team today all read it.
        staff: await listStaffAtProperty(tx, { propertyId }),
        // Who is clocked in decides who a request can go to, and is shown
        // beside every name on the list (D-098).
        onShift: await listOnShift(tx, propertyId),
        occupancy: maySeeGuests || mayRaise ? await listRoomsWithOccupancy(tx, { propertyId }) : [],
        // What the guest is promised, for the header, and the raise form's list.
        catalog: await getRequestCatalog(tx, { propertyId }),
        types: [],
        roles: await listRolesAtProperty(tx, { propertyId }),
      };
    },
  );

  const now = Date.now();
  const local = localTimeAt(new Date(now), data.timeZone);
  const evening = local.minutes >= 17 * 60 || local.minutes < 5 * 60;
  const promises = [...new Set(data.catalog.map((t) => t.slaMinutes))].sort((a, b) => a - b);
  const promise = promises.length === 0 ? null
    : promises.length === 1 ? `Promise: ${promises[0]} minutes.`
      : `Promises: ${promises[0]}–${promises[promises.length - 1]} minutes.`;

  const header = (
    <header className={q.head}>
      <div className={q.headText}>
        <h1 className={q.title}>Requests</h1>
        <p className={q.sub}>
          {tab === 'catalog'
            ? 'What a guest may ask for, and what the hotel promises back.'
            : <>Everything guests have asked for {evening ? 'tonight' : 'today'}.{promise ? <> {promise}</> : null}</>}
        </p>
      </div>
      <div className={q.headActions}>
        <nav className={q.views} aria-label="Requests">
          <Link href="/admin/requests" className={q.view} aria-current={tab === 'live' ? 'page' : undefined}>Live</Link>
          <Link href="/admin/requests?tab=team" className={q.view} aria-current={tab === 'team' ? 'page' : undefined}>Team today</Link>
          <Link href="/admin/requests?tab=catalog" className={q.view} aria-current={tab === 'catalog' ? 'page' : undefined}>What guests can ask for</Link>
        </nav>
        {mayRaise && tab === 'live' ? (
          <Link href="/admin/requests?raise=1" scroll={false} className={q.btn}>
            <PhoneCall size={15} aria-hidden="true" />Raise for a guest who phoned
          </Link>
        ) : null}
      </div>
    </header>
  );

  if (tab === 'catalog') {
    return (
      <div className={q.page}>
        {header}
        <RequestTypeEditor
          propertyId={propertyId}
          types={data.types}
          roles={data.roles}
          mayManage={can(session, propertyId, 'request_type:manage')}
        />
      </div>
    );
  }

  const onShiftIds = new Set(data.onShift.map((shift) => shift.staffUserId));
  const shiftOf = new Map(data.onShift.map((shift) => [shift.staffUserId, shift]));
  const guestIn = new Map(data.occupancy.filter((r) => r.stay).map((r) => [r.number, r.stay!.guestName]));
  const roleName = new Map(data.roles.map((role) => [role.key, role.name]));
  const clock = (at: Date) => formatClock(toClock(localTimeAt(new Date(at), data.timeZone).minutes));
  const isLive = (r: RequestDetail) => r.status === 'OPEN' || r.status === 'ASSIGNED' || r.status === 'IN_PROGRESS';

  const view = (r: RequestDetail): LiveRequestView => ({
    id: r.id,
    number: r.requestNumber,
    room: r.roomNumber,
    floorId: r.floorId,
    floorName: r.floorName,
    what: r.lines.map((line) => `${line.quantity}× ${line.label}`).join(', ') || r.requestNumber,
    note: r.guestNote,
    status: r.status,
    statusLabel: STATUS_LABEL[r.status],
    assignee: r.assignedStaffName,
    assigneeId: r.assignedStaffId,
    assigneeOnShift: r.assignedStaffId ? onShiftIds.has(r.assignedStaffId) : null,
    guestName: maySeeGuests && isLive(r) ? guestIn.get(r.roomNumber) ?? null : null,
    // The desk's raise writes this note (D-096); nothing else does.
    source: r.guestNote?.startsWith('Taken by phone') ? 'phone' : 'app',
    askedAt: clock(r.createdAt),
    askedAtMs: new Date(r.createdAt).getTime(),
    slaTargetMs: isLive(r) && r.slaTargetAt ? new Date(r.slaTargetAt).getTime() : null,
    promisedAt: isLive(r) && r.slaTargetAt ? clock(r.slaTargetAt) : null,
    escalated: r.escalationLevel >= 2,
    charge: r.totalMinor > 0 ? formatMoney(money(r.totalMinor, r.currency)) : null,
    // A refused or cancelled request never completes; it is finished "today"
    // because that is the only list it appears in.
    closedAt: r.completedAt ? clock(r.completedAt)
      : r.status === 'REJECTED' || r.status === 'CANCELLED' ? 'today' : null,
    reason: r.rejectionReason ?? r.cancellationReason,
    minutesToDone: r.completedAt
      ? Math.max(0, Math.round((new Date(r.completedAt).getTime() - new Date(r.createdAt).getTime()) / 60_000))
      : null,
  });

  /* ── Who has what (D-097), for Team today and the Team on shift strip ── */
  const finished = (r: RequestDetail) => r.status === 'COMPLETED' || r.status === 'VERIFIED';
  const minutes = (r: RequestDetail) => r.completedAt
    ? Math.max(0, Math.round((new Date(r.completedAt).getTime() - new Date(r.createdAt).getTime()) / 60_000)) : null;
  const inTime = (r: RequestDetail) => !r.slaTargetAt || (r.completedAt !== null && new Date(r.completedAt) <= new Date(r.slaTargetAt));
  const average = (rs: RequestDetail[]) => {
    const ms = rs.map(minutes).filter((m): m is number => m !== null);
    return ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null;
  };
  const liveRaw = data.open.filter((r) => r.status !== 'COMPLETED');
  const doneRaw = [...data.open.filter(finished), ...data.closed.filter(finished)]
    .filter((r, i, all) => all.findIndex((x) => x.id === r.id) === i);
  const active = data.staff.filter((person) => person.status === 'ACTIVE');

  const people: PersonLoad[] = active
    .map((person) => {
      const has = liveRaw.filter((r) => r.assignedStaffId === person.id);
      const done = doneRaw.filter((r) => r.assignedStaffId === person.id);
      const shift = shiftOf.get(person.id);
      const floors = shift ? shift.zones.map((z) => z.floorName).join(', ') || 'no floors' : null;
      return {
        id: person.id,
        name: person.fullName,
        role: person.roleKeys.map((key) => roleName.get(key) ?? key)[0] ?? null,
        floors,
        onShift: shift ? `on shift · ${floors}` : null,
        carrying: has.length,
        late: has.filter((r) => r.breached).length,
        done: done.length,
        onTime: done.filter(inTime).length,
        averageMinutes: average(done),
      };
    })
    .filter((p) => p.onShift || p.carrying || p.done)
    .sort((a, b) => b.carrying - a.carrying || b.done - a.done || a.name.localeCompare(b.name));

  if (tab === 'team') {
    const labelOf = (r: RequestDetail) => r.lines[0]?.label ?? 'Other';
    const labels = [...new Set([...liveRaw, ...doneRaw].map(labelOf))];
    const types: TypeLoad[] = labels.map((label) => {
      const openNow = liveRaw.filter((r) => labelOf(r) === label);
      const done = doneRaw.filter((r) => labelOf(r) === label);
      return {
        label,
        openNow: openNow.length,
        lateNow: openNow.filter((r) => r.breached).length,
        done: done.length,
        onTime: done.filter(inTime).length,
        averageMinutes: average(done),
      };
    }).sort((a, b) => (b.averageMinutes ?? -1) - (a.averageMinutes ?? -1) || b.lateNow - a.lateNow);

    return (
      <div className={q.page}>
        {header}
        <p className={q.summary}>
          <span className="tabular">{people.filter((p) => p.onShift).length}</span> on shift ·{' '}
          <span className="tabular">{liveRaw.length}</span> open · <span className="tabular">{doneRaw.length}</span> done today
        </p>
        <TeamToday people={people} types={types} />
      </div>
    );
  }

  const open = data.open.map(view);
  const closed = data.closed.map(view);
  const selected = params.request ? [...open, ...closed].find((r) => r.id === params.request) ?? null : null;
  const raising = !selected && params.raise === '1' && mayRaise;

  // Who a request can be given to: on shift first, with the floors they
  // cover, then everybody else who can sign in.
  const staff: AssignableStaff[] = active
    .map((person) => {
      const shift = shiftOf.get(person.id);
      return {
        id: person.id,
        name: person.fullName,
        onShift: !!shift,
        floors: shift ? shift.zones.map((z) => z.floorName).join(', ') || 'no floors' : null,
        floorIds: shift ? shift.zones.map((z) => z.floorId) : [],
        holding: liveRaw.filter((r) => r.assignedStaffId === person.id).length,
      };
    })
    .sort((a, b) => Number(b.onShift) - Number(a.onShift) || a.name.localeCompare(b.name));

  return (
    <div className={q.page}>
      {header}
      <div className={q.board} data-aside={selected || raising ? 'open' : undefined}>
        <div className={q.boardMain}>
          <LiveRequests
            open={open}
            closed={closed}
            floors={data.floors.map((f) => ({ id: f.id, name: f.name }))}
            selected={selected?.id ?? null}
            serverNow={now}
          />
          <TeamOnShift people={people} />
        </div>

        {selected ? (
          <Aside label={`Request ${selected.number}`} closeHref="/admin/requests">
            <RequestPanel
              propertyId={propertyId}
              request={selected}
              staff={staff}
              serverNow={now}
              permissions={{
                assign: mayAssign,
                advance: can(session, propertyId, 'request:advance'),
                verify: can(session, propertyId, 'request:verify'),
                cancel: can(session, propertyId, 'request:cancel'),
              }}
            />
          </Aside>
        ) : raising ? (
          <Aside label="Raise for a guest who phoned" closeHref="/admin/requests">
            <RaiseForGuest
              propertyId={propertyId}
              rooms={data.occupancy.filter((r) => r.stay).map((r) => ({ id: r.id, number: r.number, guestName: r.stay!.guestName }))}
              catalog={data.catalog.map((type) => ({
                id: type.id,
                label: type.priceMinor > 0 ? `${type.name} · ${formatMoney(money(type.priceMinor, type.currency))}` : type.name,
                allowsQuantity: type.allowsQuantity,
                maxQuantity: type.maxQuantity,
              }))}
              raiseKey={randomUUID()}
            />
          </Aside>
        ) : null}
      </div>
    </div>
  );
}
