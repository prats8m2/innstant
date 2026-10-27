import { withTenant } from '@/db';
import { adminAccess, AdminDenied } from '../guard';
import { can, findProperty } from '@/modules/identity';
import {
  getInRoomDiningOutlet, getAdminMenu, listCollections, scheduleState, describeSchedule,
  TODAYS_SPECIAL, listOffers, bestOffer,
} from '@/modules/catalog';
import { localTimeAt } from '@/lib/clock';
import { AdminShell } from '../admin-shell';
import { MenuStudio, type ScheduledCard } from './menu-studio';
import { scheduleLabel } from './schedule-label';
import styles from '../admin.module.css';

/**
 * The menu, editable.
 *
 * Until this screen existed the only way to change a hotel's menu was to edit
 * `kesari-menu.ts` and re-run the seeder — which also wipes the property. That
 * is the gap this closes.
 *
 * Sections and dishes in one view rather than two: the question an F&B manager
 * arrives with is almost always "where is this dish and what does it cost", and
 * a separate sections screen makes that two navigations.
 */
export const dynamic = 'force-dynamic';

export default async function MenuAdmin() {
  // Checked against the property being edited, not merely "is someone signed
  // in". Every button below is drawn from the same session's permissions and
  // re-checked by its action.
  const access = await adminAccess('catalog:read');
  if (!access.ok) return <AdminDenied reason={access.reason} />;
  const { session, propertyId } = access;

  const mayCurate = can(session, propertyId, 'catalog:manage');

  const mayPrice = can(session, propertyId, 'catalog:pricing');

  const { property, outlet, menu, collections, offers } = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => {
      const found = await getInRoomDiningOutlet(tx, propertyId);
      return {
        property: await findProperty(tx, propertyId),
        outlet: found,
        menu: found ? await getAdminMenu(tx, { outletId: found.id }) : null,
        // The scheduled menus strip is curation, behind the same permission
        // as the collections page it links to.
        collections: found && mayCurate ? await listCollections(tx, { outletId: found.id }) : [],
        offers: found ? await listOffers(tx, { outletId: found.id }) : [],
      };
    },
  );

  const propertyName = property?.name ?? 'This property';

  if (!outlet || !menu) {
    return (
      <AdminShell session={session} propertyId={propertyId} propertyName={propertyName} current="menu">
        <h1 className={styles.title}>Menu</h1>
        <p className={styles.empty}>
          No in-room dining outlet is configured here. One is created with the
          property — see <code>provisionProperty()</code>.
        </p>
      </AdminShell>
    );
  }

  // The hotel's now, not the server's (CLAUDE.md "Dates"): the preview's
  // "today", and what every card on the strip is measured against.
  const now = localTimeAt(new Date(), property?.timezone ?? 'Asia/Kolkata');

  // Worked out here rather than on the board: the rules live in the catalog
  // module, which a client component must not import (it carries the
  // database client). The board gets plain, already-decided cards.
  const scheduled: ScheduledCard[] = collections.map((c) => {
    const state = scheduleState(c, now);
    const { label, tone } = scheduleLabel(state);
    return {
      id: c.id,
      name: c.name,
      schedule: describeSchedule(c, now.date),
      label: !c.isActive ? 'switched off' : !c.items.length ? 'empty, so not showing' : label,
      tone: !c.isActive || !c.items.length ? 'off' : tone,
      dishes: c.items.map((i) => i.name),
    };
  });
  // Which dishes an offer is pricing THIS minute, by the same bestOffer() the
  // guest's card and the cart use (D-085). The board shows the list price it
  // edits, and this beside it, so nobody reprices a dish thinking ₹920 is
  // what it costs.
  const liveOffers: Record<string, string> = {};
  for (const category of menu.categories) {
    for (const item of category.items) {
      const applied = bestOffer(offers, { ...item, categoryId: category.id }, now);
      if (applied) liveOffers[item.id] = `${applied.label} now · ${applied.name}`;
    }
  }

  const todaysSpecialOn = collections.some((c) => c.name === TODAYS_SPECIAL
    && c.isActive && c.startsOn === now.date && c.endsOn === now.date);

  return (
    <AdminShell session={session} propertyId={propertyId} propertyName={propertyName} current="menu">
      <MenuStudio
        propertyId={propertyId}
        menu={menu}
        now={{ dayOfWeek: now.dayOfWeek, date: now.date! }}
        scheduled={scheduled}
        todaysSpecialOn={todaysSpecialOn}
        liveOffers={liveOffers}
        offerCount={mayPrice ? offers.length : null}
        permissions={{
          manage: can(session, propertyId, 'catalog:manage'),
          pricing: can(session, propertyId, 'catalog:pricing'),
          availability: can(session, propertyId, 'catalog:availability'),
        }}
      />
    </AdminShell>
  );
}
