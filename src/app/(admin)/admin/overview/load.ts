import { withTenant } from '@/db';
import { can, findProperty, type StaffSession } from '@/modules/identity';
import {
  getInRoomDiningOutletConfig, getAdminMenu, getOutletHours, listUnavailableItems,
  portionsLeftToday, outletOpenState, describeOpenState,
} from '@/modules/catalog';
import {
  listRoomsWithOccupancy, listCheckoutRequests, listDeparturesToday, listUnpaidDepartures,
  occupancyReport, listArrivalsToday,
} from '@/modules/stay';
import { getOpenRequests, requestsReport } from '@/modules/requests';
import { kitchenTickets, ordersReport } from '@/modules/ordering';
import { postedRevenueReport } from '@/modules/billing';
import { formatClock, localTimeAt } from '@/lib/clock';
import { currentBucket, reportWindow, type ReportRange } from '@/lib/report-window';
import type { CurrencyCode } from '@/lib/money';

/**
 * Everything the overview shows, read in one tenant-scoped transaction — the
 * page and its CSV export both call this, so the file a GM downloads is the
 * screen they were looking at.
 *
 * Every block is skipped entirely for an account that cannot open the screen
 * behind it, exactly as the overview always did:
 *
 *   stays      `stay:read`     occupancy, arriving & leaving, late checkouts
 *   requests   `request:read`  requests on time, late requests
 *   orders     `order:read`    orders, the live floor, the chart (as counts)
 *   sales      `order:read` + `catalog:pricing` — the chart in money, and
 *              food & drink sales. A kitchen sees tickets, not takings.
 *   folios     `folio:read`    rooms and services revenue, money left owing
 *   menu       `catalog:read`  portions running low, dishes off
 *
 * Revenue as one figure needs both sales and folios; an F&B manager without
 * folios is shown food & drink sales under that name instead.
 */
export type Overview = Awaited<ReturnType<typeof loadOverview>>;

export async function loadOverview(session: StaffSession, propertyId: string, range: ReportRange) {
  const may = {
    stays: can(session, propertyId, 'stay:read'),
    requests: can(session, propertyId, 'request:read'),
    /** Whether "Assign" is a thing this account can do, or only "Open". */
    assign: can(session, propertyId, 'request:assign'),
    orders: can(session, propertyId, 'order:read'),
    sales: can(session, propertyId, 'order:read') && can(session, propertyId, 'catalog:pricing'),
    folios: can(session, propertyId, 'folio:read'),
    menu: can(session, propertyId, 'catalog:read'),
  };

  return withTenant({ tenantId: session.tenantId, propertyId }, async (tx) => {
    const now = new Date();
    const property = await findProperty(tx, propertyId);
    const timeZone = property?.timezone ?? 'Asia/Kolkata';
    const at = localTimeAt(now, timeZone);
    const window = reportWindow(range, timeZone);
    const upto = currentBucket(window, at.minutes);
    const outlet = await getInRoomDiningOutletConfig(tx, propertyId);
    const currency = (outlet?.currency ?? 'INR') as CurrencyCode;

    const hours = outlet ? await getOutletHours(tx, outlet.id) : [];
    const kitchenLine = !outlet
      ? null
      : !outlet.isAcceptingOrders
        ? 'kitchen not taking orders'
        : lowerFirst(describeOpenState(outletOpenState(hours, at), formatClock));

    const rooms = may.stays ? await listRoomsWithOccupancy(tx, { propertyId }) : [];
    const menu = may.menu && outlet ? await getAdminMenu(tx, { outletId: outlet.id }) : null;
    const dishes = menu ? menu.categories.flatMap((c) => c.items) : [];

    return {
      may,
      now,
      timeZone,
      at,
      window,
      upto,
      currency,
      propertyName: property?.name ?? 'This property',
      outlet,
      kitchenLine,
      rooms,
      openRequests: may.requests ? await getOpenRequests(tx, { propertyId }) : [],
      checkouts: may.stays ? await listCheckoutRequests(tx, { propertyId }) : [],
      arrivals: may.stays ? await listArrivalsToday(tx, { propertyId, timeZone }) : [],
      departures: may.stays ? await listDeparturesToday(tx, { propertyId, timeZone }) : { due: [], left: [] },
      // The recent ones: an old debt is the Leaving screen's list, not a
      // morning's "needs you".
      unpaid: may.stays && may.folios ? await listUnpaidDepartures(tx, { propertyId, withinDays: 3 }) : [],
      occupancy: may.stays ? await occupancyReport(tx, { propertyId, window }) : null,
      requestsReport: may.requests ? await requestsReport(tx, { propertyId, window }) : null,
      orders: may.orders ? await ordersReport(tx, { propertyId, window, currency }) : null,
      revenue: may.sales && may.folios ? await postedRevenueReport(tx, { propertyId, window, currency }) : null,
      // Everything between the pass and the door, not just the kitchen's rail.
      tickets: may.orders && outlet
        ? await kitchenTickets(tx, {
            outletId: outlet.id,
            statuses: ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'],
          })
        : [],
      dishes: dishes.map((d) => ({ id: d.id, name: d.name })),
      portions: dishes.length && at.date
        ? await portionsLeftToday(tx, { itemIds: dishes.map((d) => d.id), businessDate: at.date })
        : new Map<string, { limit: number; left: number }>(),
      unavailable: menu ? await listUnavailableItems(tx, { outletId: menu.outlet.id }) : [],
    };
  });
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
