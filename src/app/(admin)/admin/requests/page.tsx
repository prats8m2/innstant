import Link from 'next/link';
import { withTenant } from '@/db';
import { adminAccess, AdminDenied } from '../guard';
import { can, findProperty, listFloors, listRolesAtProperty, listStaffAtProperty } from '@/modules/identity';
import {
  getAdminRequestTypes, getOpenRequests, getRequestsClosedToday, type RequestDetail,
} from '@/modules/requests';
import { listOnShift } from '@/modules/housekeeping';
import { formatMoney, money } from '@/lib/money';
import { formatClock, formatMinutes, localTimeAt, toClock } from '@/lib/clock';
import { SidePanel } from '../side-panel';
import { RequestTypeEditor } from './request-type-editor';
import {
  LiveRequests, RequestPanel, type AssignableStaff, type LiveRequestView,
} from './live-requests';
import styles from '../admin.module.css';
import s from '../staff/staff.module.css';
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
  OPEN: 'Waiting',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'On the way',
  COMPLETED: 'Done, not checked',
  VERIFIED: 'Checked',
  REJECTED: 'Refused',
  CANCELLED: 'Cancelled',
};

export default async function RequestsAdmin({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; request?: string }>;
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
  const tab = params.tab === 'catalog' ? 'catalog' : 'live';

  const mayAssign = can(session, propertyId, 'request:assign');

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
          timeZone, open, closed: [] as RequestDetail[], floors: [], staff: [], onShift: [],
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
        // Only for somebody who may give a request to a person.
        staff: mayAssign ? await listStaffAtProperty(tx, { propertyId }) : [],
        onShift: mayAssign ? await listOnShift(tx, propertyId) : [],
        types: [],
        roles: [],
      };
    },
  );

  const liveCount = data.open.filter((r) => r.status !== 'COMPLETED').length;
  const tabs = (
    <nav className={q.tabs} aria-label="Requests">
      <Link href="/admin/requests" className={q.tab} aria-current={tab === 'live' ? 'page' : undefined}>
        Live <span className={`${q.tabCount} tabular`}>{liveCount}</span>
      </Link>
      <Link href="/admin/requests?tab=catalog" className={q.tab} aria-current={tab === 'catalog' ? 'page' : undefined}>
        What guests can ask for
      </Link>
    </nav>
  );

  if (tab === 'catalog') {
    return (
      <>
        <h1 className={styles.title}>Requests</h1>
        {tabs}
        <RequestTypeEditor
          propertyId={propertyId}
          types={data.types}
          roles={data.roles}
          mayManage={can(session, propertyId, 'request_type:manage')}
        />
      </>
    );
  }

  const clock = (at: Date) => formatClock(toClock(localTimeAt(new Date(at), data.timeZone).minutes));
  const view = (r: RequestDetail): LiveRequestView => {
    const minutesToDone = r.completedAt
      ? Math.max(0, Math.round((new Date(r.completedAt).getTime() - new Date(r.createdAt).getTime()) / 60_000))
      : null;
    const running = r.secondsRemaining !== null;
    return {
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
      askedAt: clock(r.createdAt),
      sla: running && r.secondsRemaining !== null
        ? r.breached
          ? `${formatMinutes(Math.abs(r.secondsRemaining) / 60)} over`
          : `${formatMinutes(r.secondsRemaining / 60)} left`
        : null,
      late: running && r.breached,
      escalated: r.escalationLevel >= 2,
      charge: r.totalMinor > 0 ? formatMoney(money(r.totalMinor, r.currency)) : null,
      // A refused or cancelled request never completes; it is finished "today"
      // because that is the only list it appears in.
      closedAt: r.completedAt ? clock(r.completedAt)
        : r.status === 'REJECTED' || r.status === 'CANCELLED' ? 'today' : null,
      reason: r.rejectionReason ?? r.cancellationReason,
      minutesToDone,
    };
  };

  const open = data.open.map(view);
  const closed = data.closed.map(view);
  const live = open.filter((r) => r.status !== 'COMPLETED');
  const done = closed.filter((r) => r.minutesToDone !== null);
  const averageToDone = done.length
    ? Math.round(done.reduce((sum, r) => sum + r.minutesToDone!, 0) / done.length)
    : null;

  // Who a request can be given to: on shift first, with the floors they
  // cover, then everybody else who can sign in.
  const shiftOf = new Map(data.onShift.map((shift) => [shift.staffUserId, shift]));
  const staff: AssignableStaff[] = data.staff
    .filter((person) => person.status === 'ACTIVE')
    .map((person) => {
      const shift = shiftOf.get(person.id);
      return {
        id: person.id,
        name: person.fullName,
        note: shift ? `on shift · ${shift.zones.map((z) => z.floorName).join(', ') || 'no floors'}` : '',
      };
    })
    .sort((a, b) => Number(!!b.note) - Number(!!a.note) || a.name.localeCompare(b.name));

  const linkFor = Object.fromEntries([...open, ...closed].map((r) => [r.id, `/admin/requests?request=${r.id}`]));
  const selected = params.request ? [...open, ...closed].find((r) => r.id === params.request) ?? null : null;

  return (
    <>
      <header className={styles.pageHead}>
        <div>
          <h1 className={styles.title}>Requests</h1>
          <p className={styles.lede}>
            {live.length === 0 ? 'Nothing open.' : `${live.length} open`}
            {live.some((r) => r.late) ? ` · ${live.filter((r) => r.late).length} late` : ''}
            {` · ${closed.length} finished today`}
          </p>
        </div>
      </header>
      {tabs}

      <ul className={`${s.stats} ${q.stats}`} aria-label="Today">
        <li className={s.stat}>
          <span className={s.statLabel}>Open</span>
          <span className={s.statValue}>{live.length}</span>
          <span className={s.statSub}>on every floor</span>
        </li>
        <li className={s.stat} data-tone={live.some((r) => r.late) ? 'critical' : undefined}>
          <span className={s.statLabel}>Late</span>
          <span className={s.statValue}>{live.filter((r) => r.late).length}</span>
          <span className={s.statSub}>past what the guest was promised</span>
        </li>
        <li className={s.stat} data-tone={live.some((r) => r.status === 'OPEN') ? 'critical' : undefined}>
          <span className={s.statLabel}>Nobody has it</span>
          <span className={s.statValue}>{live.filter((r) => r.status === 'OPEN').length}</span>
          <span className={s.statSub}>waiting for a person</span>
        </li>
        <li className={s.stat} data-tone="positive">
          <span className={s.statLabel}>Finished today</span>
          <span className={s.statValue}>{closed.length}</span>
          <span className={s.statSub}>
            {averageToDone === null ? 'nothing done yet' : `${averageToDone} min from asking to done, on average`}
          </span>
        </li>
      </ul>

      <LiveRequests
        open={open}
        closed={closed}
        floors={data.floors.map((f) => ({ id: f.id, name: f.name }))}
        linkFor={linkFor}
        selected={selected?.id ?? null}
      />

      {selected ? (
        <SidePanel title={`${selected.room} · ${selected.what}`} subtitle={`${selected.number} · ${selected.statusLabel}`} closeHref="/admin/requests">
          <RequestPanel
            propertyId={propertyId}
            request={selected}
            staff={staff}
            permissions={{
              assign: mayAssign,
              advance: can(session, propertyId, 'request:advance'),
              verify: can(session, propertyId, 'request:verify'),
              cancel: can(session, propertyId, 'request:cancel'),
            }}
          />
        </SidePanel>
      ) : null}
    </>
  );
}
