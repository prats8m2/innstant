import { withTenant } from '@/db';
import { requireStaffSession, requirePermission } from '@/lib/auth-context';
import { can, findProperty } from '@/modules/identity';
import { getInRoomDiningOutlet, getAdminMenu } from '@/modules/catalog';
import { AdminShell } from '../admin-shell';
import { MenuEditor } from './menu-editor';
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
  const signedIn = await requireStaffSession();

  // The property switcher is still admin work — the KDS and the runner make the
  // same placeholder choice.
  const propertyId = [...signedIn.properties.keys()][0];
  if (!propertyId) {
    return (
      <div className={styles.frame}>
        <main className={styles.main}>
          <p className={styles.empty}>This account has no property assigned.</p>
        </main>
      </div>
    );
  }

  // Checked against the property being edited, not merely "is someone signed
  // in". Throws 403 here, 404 at a property this account holds no role at.
  const session = await requirePermission(propertyId, 'catalog:read');

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
      <AdminShell session={session} propertyName={propertyName} current="menu">
        <h1 className={styles.title}>Menu</h1>
        <p className={styles.empty}>
          No in-room dining outlet is configured here. One is created with the
          property — see <code>provisionProperty()</code>.
        </p>
      </AdminShell>
    );
  }

  return (
    <AdminShell session={session} propertyName={propertyName} current="menu">
      <MenuEditor
        propertyId={propertyId}
        menu={menu}
        permissions={{
          manage: can(session, propertyId, 'catalog:manage'),
          pricing: can(session, propertyId, 'catalog:pricing'),
          availability: can(session, propertyId, 'catalog:availability'),
        }}
      />
    </AdminShell>
  );
}
