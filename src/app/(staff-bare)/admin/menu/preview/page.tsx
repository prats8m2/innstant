import { notFound } from 'next/navigation';
import { withTenant } from '@/db';
import { getInRoomDiningMenu, getOutletHours } from '@/modules/catalog';
import { findProperty } from '@/modules/identity';
import { localTimeAt, parseClock, dayOfWeekOf, type LocalTime } from '@/lib/clock';
import { MenuView } from '@/app/(guest)/r/[qrCode]/menu/menu-view';
import guestStyles from '@/app/(guest)/guest.module.css';
import { adminAccess, AdminDenied } from '@/app/(admin)/admin/guard';
import { PreviewGuard } from './preview-guard';

/**
 * The guest's menu, as it would read at a moment the manager chooses.
 *
 * In its own route group, `(staff-bare)`, at the same URL, so the console's
 * layout does NOT wrap it: inside the console group, the rail's top bar and
 * drawer rendered INSIDE the studio's phone frame, above the guest's menu.
 *
 * Framed by the menu studio at phone width, and nothing else: no console
 * shell, the guest theme, and the guest screen's own component. It reads
 * through `getInRoomDiningMenu()`, the call the guest screen makes, so a
 * collection's window, a dish's own hours and a dish switched off all apply
 * here exactly as they will there.
 *
 * `?date=YYYY-MM-DD&time=HH:MM` is property-local, like everything a guest
 * sees (CLAUDE.md "Dates"). A date, not a weekday, since D-084: a menu that
 * runs 1–5 November is only visible on those dates. Without them it is now,
 * in the property's timezone.
 *
 * What it does not show is a particular guest's cart. Nobody is signed in to
 * it, so the pill shows the kitchen's line.
 */
export const dynamic = 'force-dynamic';

export default async function MenuPreview({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; time?: string }>;
}) {
  const access = await adminAccess('catalog:read');
  if (!access.ok) return <AdminDenied reason={access.reason} />;
  const { session, propertyId } = access;
  const query = await searchParams;

  const loaded = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => {
      const property = await findProperty(tx, propertyId);
      const at = chosenMoment(query, localTimeAt(new Date(), property?.timezone ?? 'Asia/Kolkata'));
      const menu = await getInRoomDiningMenu(tx, propertyId, at);
      if (!menu) return null;
      return { menu, at, hours: await getOutletHours(tx, menu.outlet.id) };
    },
  );

  if (!loaded) notFound();

  return (
    <div data-theme="kesari" className={guestStyles.ground}>
      <PreviewGuard />
      <MenuView
        qrCode="preview"
        menu={loaded.menu}
        hours={loaded.hours}
        at={loaded.at}
        inCart={new Map()}
        cart={null}
      />
    </div>
  );
}

/** A malformed query falls back to now rather than refusing to draw. */
function chosenMoment(query: { date?: string; time?: string }, now: LocalTime): LocalTime {
  let minutes = now.minutes;
  try {
    if (query.time) minutes = parseClock(query.time);
  } catch {
    // Not a time of day; keep now.
  }
  const date = query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date)
    && !Number.isNaN(Date.parse(`${query.date}T00:00:00Z`))
    ? query.date
    : now.date;
  return date
    ? { dayOfWeek: dayOfWeekOf(date), minutes, date }
    : { dayOfWeek: now.dayOfWeek, minutes };
}
