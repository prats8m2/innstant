import type { NextRequest } from 'next/server';
import { requireStaffSession } from '@/lib/auth-context';
import { httpStatusFor, publicPayloadFor } from '@/lib/errors';
import { parseReportRange } from '@/lib/report-window';
import { folioRevenueMinor } from '@/modules/billing';
import { loadOverview } from '../load';
import { addSeries, bucketTitle, csvLine, minorToDecimal, soFar } from '../kpis';

/**
 * The overview's Export: the period's numbers, one row per hour (today) or
 * per day (7 / 30 days), as CSV — the same reads as the screen
 * (`loadOverview`), so the file is what the GM was looking at.
 *
 * Columns follow the account's permissions exactly as the screen's tiles do:
 * a front desk's file has no money from orders, a kitchen's no rooms. Money
 * is a plain decimal in the property's currency (no symbol, no grouping), so
 * a spreadsheet sums it.
 *
 * GET, read-only, and authorised like the page: a staff session at the
 * property, and each column on its own permission.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<Response> {
  let session;
  try {
    session = await requireStaffSession();
  } catch (error) {
    return Response.json(publicPayloadFor(error), { status: httpStatusFor(error) });
  }
  const propertyId = [...session.properties.keys()][0];
  if (!propertyId) {
    return Response.json({ code: 'FORBIDDEN', message: 'This account has no property assigned.' }, { status: 403 });
  }

  const range = parseReportRange(request.nextUrl.searchParams.get('range'));
  const data = await loadOverview(session, propertyId, range);
  const { window, upto } = data;
  const n = upto + 1;

  const columns: { name: string; values: (string | number)[] }[] = [];
  const money = (series: number[]) => soFar(series, upto).map((v) => minorToDecimal(v));

  if (data.orders && data.may.sales) {
    const corrections = data.revenue?.current.byBucket.map((p) => p.foodCorrectionsMinor);
    const food = corrections ? addSeries(data.orders.current.salesByBucket, corrections) : data.orders.current.salesByBucket;
    if (data.revenue) {
      const folio = data.revenue.current.byBucket;
      columns.push({
        name: `revenue_${data.currency.toLowerCase()}`,
        values: money(addSeries(data.orders.current.salesByBucket, folio.map(folioRevenueMinor))),
      });
      columns.push({ name: `rooms_${data.currency.toLowerCase()}`, values: money(folio.map((p) => p.roomsMinor)) });
      columns.push({
        name: `services_${data.currency.toLowerCase()}`,
        values: money(folio.map((p) => p.servicesMinor + p.creditsMinor)),
      });
    }
    columns.push({ name: `food_and_drink_${data.currency.toLowerCase()}`, values: money(food) });
  }
  if (data.orders) {
    columns.push({ name: 'orders', values: soFar(data.orders.current.ordersByBucket, upto) });
    columns.push({ name: 'orders_delivered', values: soFar(data.orders.current.deliveredByBucket, upto) });
  }
  if (data.requestsReport) {
    columns.push({ name: 'requests_finished', values: soFar(data.requestsReport.current.finishedByBucket, upto) });
    columns.push({ name: 'requests_on_time', values: soFar(data.requestsReport.current.onTimeByBucket, upto) });
  }
  if (data.occupancy) {
    columns.push({ name: 'rooms_in_house', values: soFar(data.occupancy.current, upto) });
    columns.push({ name: 'rooms_sellable', values: Array.from({ length: n }, () => data.rooms.length) });
  }

  const lines = [
    csvLine([window.bucket === 'hour' ? 'hour' : 'day', ...columns.map((c) => c.name)]),
    ...Array.from({ length: n }, (_, i) => csvLine([
      bucketTitle(window, i, data.at.date!),
      ...columns.map((c) => c.values[i] ?? ''),
    ])),
  ];

  const name = `overview-${range}-${data.at.date}.csv`;
  return new Response(`${lines.join('\n')}\n`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });
}
