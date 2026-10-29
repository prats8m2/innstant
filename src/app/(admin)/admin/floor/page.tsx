import { withTenant } from '@/db';
import { adminAccess, AdminDenied } from '../guard';
import { can, findProperty, listStaffAtProperty, listRolesAtProperty } from '@/modules/identity';
import { getInRoomDiningOutletConfig } from '@/modules/catalog';
import { kitchenTickets, daySummary, stageTimesToday } from '@/modules/ordering';
import { listOnShift } from '@/modules/housekeeping';
import { getOpenRequests } from '@/modules/requests';
import { FloorBoard, type FloorTicket, type FloorPerson } from './floor-board';
import styles from '../admin.module.css';

/**
 * The floor as a manager sees it (D-089): every open ticket's stage and age,
 * who is on shift and where, and which stage the time is going into today.
 *
 * Not a fourth copy of the kitchen display. The KDS is a tool for the person
 * cooking — big type, buttons, one tablet. This is the view from the office or
 * the GM's phone: read-only, everything at once, and the question it answers
 * is "is the floor all right, and if not, where is it stuck?".
 *
 * Server-rendered; the client half keeps the ages ticking and refreshes on
 * every order event from the same stream the kitchen uses.
 */
export const dynamic = 'force-dynamic';

const OPEN = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'] as const;

export default async function LiveFloor() {
  const access = await adminAccess('order:read');
  if (!access.ok) return <AdminDenied reason={access.reason} />;
  const { session, propertyId } = access;

  const mayReadShifts = can(session, propertyId, 'shift:read');
  const mayReadRequests = can(session, propertyId, 'request:read');

  const data = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => {
      const property = await findProperty(tx, propertyId);
      const timeZone = property?.timezone ?? 'Asia/Kolkata';
      const outlet = await getInRoomDiningOutletConfig(tx, propertyId);
      return {
        property,
        timeZone,
        outlet,
        tickets: outlet ? await kitchenTickets(tx, { outletId: outlet.id, statuses: OPEN }) : [],
        summary: await daySummary(tx, { propertyId, timeZone, currency: property?.currency ?? 'INR' }),
        stages: await stageTimesToday(tx, { propertyId, timeZone }),
        onShift: mayReadShifts ? await listOnShift(tx, propertyId) : null,
        // Names for the runners carrying trays and the people on shift.
        staff: await listStaffAtProperty(tx, { propertyId }),
        roles: await listRolesAtProperty(tx, { propertyId }),
        requests: mayReadRequests ? await getOpenRequests(tx, { propertyId }) : null,
      };
    },
  );

  if (!data.outlet) {
    return (
      <>
        <h1 className={styles.title}>Live floor</h1>
        <p className={styles.empty}>No kitchen is configured at this property.</p>
      </>
    );
  }

  const nameOf = (id: string | null) => (id ? data.staff.find((s) => s.id === id)?.fullName ?? null : null);

  const tickets: FloorTicket[] = data.tickets.map((ticket) => ({
    id: ticket.id,
    orderNumber: ticket.orderNumber,
    status: ticket.status,
    destination: ticket.destination,
    fulfilment: ticket.fulfilment,
    items: ticket.lines.reduce((n, line) => n + line.quantity, 0),
    placedAt: ticket.placedAt ? new Date(ticket.placedAt).toISOString() : null,
    readyAt: ticket.readyAt ? new Date(ticket.readyAt).toISOString() : null,
    promisedByAt: ticket.promisedByAt ? new Date(ticket.promisedByAt).toISOString() : null,
    runner: nameOf(ticket.assignedRunnerId),
    allergy: ticket.dietaryFlags.length > 0,
  }));

  const time = (at: Date) => new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: data.timeZone,
  }).format(at);

  const people: FloorPerson[] | null = data.onShift
    ? data.onShift.map((shift) => {
      const member = data.staff.find((s) => s.id === shift.staffUserId);
      return {
        id: shift.staffUserId,
        name: member?.fullName ?? 'Somebody',
        roles: (member?.roleKeys ?? []).map((key) => data.roles.find((r) => r.key === key)?.name ?? key),
        since: shift.clockedInAt ? time(shift.clockedInAt) : null,
        floors: shift.zones.map((zone) => zone.floorName),
      };
    })
    : null;

  const requests = data.requests
    ? {
      open: data.requests.length,
      late: data.requests.filter((r) => r.breached).length,
      unassigned: data.requests.filter((r) => !r.assignedStaffId).length,
    }
    : null;

  return (
    <FloorBoard
      propertyId={propertyId}
      propertyName={data.property?.name ?? 'This property'}
      timeZone={data.timeZone}
      tickets={tickets}
      stages={data.stages}
      delivered={data.summary.today.delivered}
      deliveredOnTime={data.summary.today.deliveredOnTime}
      people={people}
      requests={requests}
      canOpenKds={can(session, propertyId, 'order:read')}
      renderedAt={Date.now()}
    />
  );
}
