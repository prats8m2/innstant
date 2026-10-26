import { withTenant } from '@/db';
import { adminAccess, AdminDenied } from '../guard';
import { can, findProperty } from '@/modules/identity';
import { getInRoomDiningOutlet, getAdminMenu } from '@/modules/catalog';
import { localTimeAt } from '@/lib/clock';
import { AdminShell } from '../admin-shell';
import { MenuStudio } from './menu-studio';
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

  const { property, outlet, menu } = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => {
      const found = await getInRoomDiningOutlet(tx, propertyId);
      return {
        property: await findProperty(tx, propertyId),
        outlet: found,
        menu: found ? await getAdminMenu(tx, { outletId: found.id }) : null,
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

  return (
    <AdminShell session={session} propertyId={propertyId} propertyName={propertyName} current="menu">
      <MenuStudio
        propertyId={propertyId}
        menu={menu}
        // The preview's "today" is the hotel's, not the server's (CLAUDE.md "Dates").
        today={localTimeAt(new Date(), property?.timezone ?? 'Asia/Kolkata').dayOfWeek}
        permissions={{
          manage: can(session, propertyId, 'catalog:manage'),
          pricing: can(session, propertyId, 'catalog:pricing'),
          availability: can(session, propertyId, 'catalog:availability'),
        }}
      />
    </AdminShell>
  );
}
