import { withTenant } from '@/db';
import { adminAccess, AdminDenied } from '../guard';
import { can, findProperty } from '@/modules/identity';
import {
  getInRoomDiningOutlet, getAdminMenu, listCollections, scheduleState, describeSchedule,
  TODAYS_SPECIAL, listOffers, bestOffer, portionsLeftToday,
} from '@/modules/catalog';
import { localTimeAt } from '@/lib/clock';
import { MenuStudio, type ScheduledCard, type Warning } from './menu-studio';
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

  const { property, outlet, menu, collections, offers, portions } = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => {
      const found = await getInRoomDiningOutlet(tx, propertyId);
      const loadedProperty = await findProperty(tx, propertyId);
      const today = localTimeAt(new Date(), loadedProperty?.timezone ?? 'Asia/Kolkata').date!;
      const adminMenu = found ? await getAdminMenu(tx, { outletId: found.id }) : null;
      return {
        // D-086: portions left today, for the limited dishes only.
        portions: adminMenu
          ? await portionsLeftToday(tx, {
              itemIds: adminMenu.categories.flatMap((c) => c.items.map((i) => i.id)),
              businessDate: today,
            })
          : new Map<string, { limit: number; left: number }>(),
        property: loadedProperty,
        outlet: found,
        menu: adminMenu,
        // The scheduled menus strip is curation, behind the same permission
        // as the collections page it links to.
        collections: found && mayCurate ? await listCollections(tx, { outletId: found.id }) : [],
        offers: found ? await listOffers(tx, { outletId: found.id }) : [],
      };
    },
  );

  if (!outlet || !menu) {
    return (
      <>
        <h1 className={styles.title}>Menu</h1>
        <p className={styles.empty}>
          No in-room dining outlet is configured here. One is created with the
          property — see <code>provisionProperty()</code>.
        </p>
      </>
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

  // "Needs attention": the menu's loose ends, each one a sentence with the
  // thing to do. Only what is true and fixable, so the strip can be trusted
  // to be empty when the menu is in order.
  const dishes = menu.categories.flatMap((c) => c.items);
  const warnings: Warning[] = [];
  const noPhoto = dishes.filter((d) => !d.imageUrl).length;
  if (noPhoto) warnings.push({ text: `${noPhoto} ${noPhoto === 1 ? 'dish has' : 'dishes have'} no photo. Guests order less of what they cannot see.`, filter: 'nophoto' });
  const noWords = dishes.filter((d) => !d.description).length;
  if (noWords) warnings.push({ text: `${noWords} ${noWords === 1 ? 'dish has' : 'dishes have'} nothing written under the name.` });
  for (const c of menu.categories) {
    if (c.items.length === 0) warnings.push({ text: `${c.name} is empty, so guests do not see it. Add a dish or archive it.` });
  }
  for (const c of collections) {
    if (!c.isActive) continue;
    const state = scheduleState(c, now);
    if (state.kind === 'ended') {
      warnings.push({ text: `${c.name} ended on its last date and is still switched on. Give it new dates or archive it.`, href: `/admin/menu/collections#collection-${c.id}` });
    } else if (c.items.length === 0) {
      warnings.push({ text: `${c.name} has no dishes, so guests do not see it. Drag one onto its card.` });
    }
  }
  for (const o of offers) {
    if (o.isActive && scheduleState(o, now).kind === 'ended') {
      warnings.push({ text: `The offer ${o.name} has ended. End it here too, or give it new dates.`, href: `/admin/menu/offers#offer-${o.id}` });
    }
  }
  const soldOut = [...portions.values()].filter((p) => p.left === 0).length;
  if (soldOut) warnings.push({ text: `${soldOut} ${soldOut === 1 ? 'dish has' : 'dishes have'} sold out today. They come back tomorrow.` });

  const todaysSpecialOn = collections.some((c) => c.name === TODAYS_SPECIAL
    && c.isActive && c.startsOn === now.date && c.endsOn === now.date);

  return (
    <>
      <MenuStudio
        propertyId={propertyId}
        menu={menu}
        now={{ dayOfWeek: now.dayOfWeek, date: now.date! }}
        scheduled={scheduled}
        todaysSpecialOn={todaysSpecialOn}
        liveOffers={liveOffers}
        offerCount={mayPrice ? offers.length : null}
        portions={Object.fromEntries(portions)}
        warnings={mayCurate ? warnings : []}
        permissions={{
          manage: can(session, propertyId, 'catalog:manage'),
          pricing: can(session, propertyId, 'catalog:pricing'),
          availability: can(session, propertyId, 'catalog:availability'),
        }}
      />
    </>
  );
}
