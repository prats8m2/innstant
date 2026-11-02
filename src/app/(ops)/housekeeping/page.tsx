import { withTenant } from '@/db';
import { redirect } from 'next/navigation';
import { getStaffSession } from '@/lib/auth-context';
import { requestPathname } from '@/lib/request-path';
import { can, consoleChrome, findProperty, listFloors, listRoomsAtProperty } from '@/modules/identity';
import { getOpenRequests, housekeeperDay, OPEN_REQUEST_STATUSES } from '@/modules/requests';
import { getCurrentShift, onDutyCount, roomCleanStates, cleanStateOf } from '@/modules/housekeeping';
import { getInRoomDiningOutletConfig } from '@/modules/catalog';
import { runnerTickets } from '@/modules/ordering';
import { Alerts } from '@/components/alerts';
import { FloorFrame, FloorHeader, OffShiftNotice } from '../floor-header';
import { isNight } from '../night';
import { FloorRequests } from './request-board';
import { RoomsToMakeUp, type RoomToMakeUp } from './rooms-to-make-up';
import { LiveBoard } from './live-board';
import styles from './housekeeping.module.css';

/**
 * The floor board — every request nobody has finished with.
 *
 * A phone screen first, unlike the KDS. A housekeeper is walking a corridor with
 * a trolley; a cook is standing at a pass. Same data, different posture, and a
 * board designed for a wall-mounted tablet is unusable in an apron pocket.
 *
 * Ordered by SLA target rather than by age (`getOpenRequests`): a wake-up call
 * raised five minutes ago is more urgent than towels raised twenty minutes ago,
 * and a board sorted by age buries exactly the thing that is about to breach.
 */
export const dynamic = 'force-dynamic';

export default async function HousekeepingBoard() {
  /**
   * No session redirects rather than throwing. The middleware is a cookie
   * turnstile that cannot reach Postgres from the edge, so it waves through a
   * REVOKED or expired cookie; throwing here renders the error boundary and an
   * always-on kitchen tablet shows "Application error" instead of a sign-in
   * form. Same reasoning as `adminAccess()`.
   */
  const session = await getStaffSession();
  if (!session) {
    const next = await requestPathname();
    redirect(next ? `/admin/login?next=${encodeURIComponent(next)}` : '/admin/login');
  }

  const propertyId = [...session.properties.keys()][0];
  if (!propertyId) {
    return (
      <main className={styles.shell}>
        <p className={styles.empty}>This account has no property assigned.</p>
      </main>
    );
  }

  if (!can(session, propertyId, 'request:read')) {
    return (
      <main className={styles.shell}>
        <p className={styles.empty}>This account cannot see service requests.</p>
      </main>
    );
  }

  const maySeePickups = can(session, propertyId, 'order:read');

  const { property, chrome, all, floors, shift, onDuty, pickups, myDay, rooms, cleanStates } = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => {
      const property = await findProperty(tx, propertyId);
      return {
        property,
        // The accent (the property's guest theme) and the role names.
        chrome: await consoleChrome(tx, { propertyId, staffUserId: session.staffUserId }),
        floors: await listFloors(tx, propertyId),
        // The shift of whoever is holding this phone, and how many people are on
        // the floors at all — the second number is what tells a lone housekeeper
        // that nobody else is covering.
        shift: await getCurrentShift(tx, { propertyId, staffUserId: session.staffUserId }),
        onDuty: await onDutyCount(tx, propertyId),
        /**
         * COMPLETED as well as the live ones.
         *
         * The state machine has VERIFIED because the person who did the work and
         * the person who checks it are different people — and a board that drops a
         * request the moment it is completed makes that button unreachable. So
         * completed-but-unchecked gets its own section below, and the count in the
         * header stays the work still to do.
         */
        all: await getOpenRequests(tx, {
          propertyId,
          statuses: [...OPEN_REQUEST_STATUSES, 'COMPLETED'],
        }),
        /**
         * Only to put a number on the other tab — the trays waiting at the pass
         * while somebody is looking at this board. A tab that only counts itself
         * is a tab nobody switches to.
         */
        pickups: maySeePickups ? await countPickups(tx, propertyId) : null,
        myDay: await housekeeperDay(tx, {
          propertyId,
          staffUserId: session.staffUserId,
          timeZone: property?.timezone ?? 'Asia/Kolkata',
        }),
        // D-096: which rooms the guests have left and nobody has made up.
        rooms: await listRoomsAtProperty(tx, { propertyId }),
        cleanStates: await roomCleanStates(tx, { propertyId }),
      };
    },
  );

  const permissions = {
    assign: can(session, propertyId, 'request:assign'),
    advance: can(session, propertyId, 'request:advance'),
    verify: can(session, propertyId, 'request:verify'),
  };

  const requests = all.filter((r) => r.status !== 'COMPLETED');
  const breached = requests.filter((r) => r.breached).length;
  const unclaimed = requests.filter((r) => r.status === 'OPEN').length;

  const timeZone = property?.timezone ?? 'Asia/Kolkata';
  const localDay = (at: Date) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(at);

  const renderedAt = Date.now();
  const makeUp: RoomToMakeUp[] = rooms.flatMap((room): RoomToMakeUp[] => {
    const state = cleanStateOf(cleanStates, room.id);
    const base = { id: room.id, number: room.number, floorId: room.floorId, floorName: room.floorName, since: state.updatedAt };
    // To make up; and, for whoever inspects, what was made up today.
    const today = state.updatedAt && localDay(state.updatedAt) === localDay(new Date());
    if (state.status === 'DIRTY') return [{ ...base, status: 'DIRTY' }];
    if (state.status === 'CLEAN' && today && permissions.verify) return [{ ...base, status: 'CLEAN' }];
    return [];
  });

  return (
    <FloorFrame
      className={styles.frame}
      /* Resolved here: a phone opened at 23:00 must not flash white first. */
      initialScheme={isNight(renderedAt, timeZone) ? 'dark' : 'light'}
      timeZone={timeZone}
      theme={chrome.theme}
    >
      <main className={styles.shell}>
        <FloorHeader
          propertyId={propertyId}
          staffUserId={session.staffUserId}
          fullName={session.fullName}
          role={chrome.roleNames.join(' · ') || 'Housekeeping'}
          stat={{ value: myDay.done, label: 'done today' }}
          shift={shift}
          floors={floors}
          timeZone={timeZone}
          renderedAt={renderedAt}
          mayClock={can(session, propertyId, 'shift:clock')}
          current="/housekeeping"
          tabs={[
            ...(maySeePickups
              ? [{ href: '/runner', label: 'Pickups', count: pickups }]
              : []),
            { href: '/housekeeping', label: 'Requests', count: requests.length },
          ]}
        />

        <div className={styles.bar}>
          <div className={styles.barText}>
            <h1 className={styles.title}>Requests</h1>
            <span className={`${styles.count} tabular`}>
              <span>{requests.length} open</span>
              {/* On time (D-090): inside each request's own promise, not an
                  average — towels at twelve and a plumber at forty do not
                  average to anything. */}
              {myDay.done ? <span>{`· ${myDay.onTime} of ${myDay.done} on time`}</span> : null}
              <span>{`· ${onDuty} on duty`}</span>
            </span>
            {breached > 0 ? (
              <span className={`${styles.late} tabular`} role="status">{breached} late</span>
            ) : null}
          </div>
          <div className={styles.barEnd}>
            <LiveBoard propertyId={propertyId} breached={breached} unclaimed={unclaimed} />
            {/* Level 1 of an escalation goes to the ASSIGNEE (D-028), and the
                assignee is holding this phone, not sitting in the ops console. */}
            <Alerts session={session} propertyId={propertyId} />
          </div>
        </div>

        {/* Routing only reaches somebody who is clocked in and covering the floor
            (`onDutyCovering`), so an off-shift board is empty for a reason. */}
        {shift ? null : <OffShiftNotice />}

        <FloorRequests
          propertyId={propertyId}
          staffUserId={session.staffUserId}
          requests={all}
          floors={floors.map((f) => ({ id: f.id, name: f.name }))}
          myFloorIds={shift?.zones.map((z) => z.floorId) ?? []}
          permissions={permissions}
          timeZone={timeZone}
          renderedAt={renderedAt}
          makeUp={
            <RoomsToMakeUp
              /* Keyed: React's dev check flags a server-made element that a
                 client component renders among its own children without one. */
              key="rooms-to-make-up"
              propertyId={propertyId}
              rooms={makeUp}
              myFloorIds={shift?.zones.map((z) => z.floorId) ?? []}
              mayClean={permissions.advance}
              mayInspect={permissions.verify}
              renderedAt={renderedAt}
            />
          }
        />
      </main>
    </FloorFrame>
  );
}

/**
 * How many trays are at the pass or already moving.
 *
 * Its own helper because it needs the outlet first and the answer is a single
 * number on a tab — `runnerTickets()` is the same query `/runner` runs, so the
 * two tabs cannot disagree about what "3" means.
 */
async function countPickups(
  tx: Parameters<typeof getInRoomDiningOutletConfig>[0],
  propertyId: string,
): Promise<number> {
  const outlet = await getInRoomDiningOutletConfig(tx, propertyId);
  if (!outlet) return 0;
  return (await runnerTickets(tx, { outletId: outlet.id })).length;
}
