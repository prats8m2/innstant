import { withTenant } from '@/db';
import { adminAccess, AdminDenied } from '../guard';
import {
  can, findProperty, listStaffAtProperty, listRolesAtProperty,
} from '@/modules/identity';
import { formatFolioDate } from '@/lib/clock';
import { AdminShell } from '../admin-shell';
import { StaffBoard, type StaffView, type RoleOption } from './staff-board';
import styles from '../admin.module.css';

/**
 * Who works here, and what they are allowed to do.
 *
 * `provisionProperty()` has created exactly one PROPERTY_ADMIN as INVITED with
 * no password since P0, and S5 never built the flow that gives them one — so a
 * hotel's second staff member was a seeder run, and the demo's GM could only
 * sign in because `demo:reset` wrote their password directly. `staff:invite`,
 * `staff:update`, `staff:deactivate`, `role:read` and `role:assign` have all
 * been declared permissions with no caller. This is the screen a pilot needs
 * before any of the others matter.
 */
export const dynamic = 'force-dynamic';

export default async function StaffAdmin() {
  // `staff:read` to look. Every control asks for its own permission again in the
  // action, and the ones this account lacks are not drawn.
  const access = await adminAccess('staff:read');
  if (!access.ok) return <AdminDenied reason={access.reason} />;
  const { session, propertyId } = access;

  const { property, staff, roles } = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => ({
      property: await findProperty(tx, propertyId),
      staff: await listStaffAtProperty(tx, { propertyId }),
      roles: await listRolesAtProperty(tx, { propertyId }),
    }),
  );

  const timeZone = property?.timezone ?? 'Asia/Kolkata';

  /**
   * Every role assignable here: the eight system roles every tenant gets from
   * `seedSystemRoles()`, plus any custom role built for this property —
   * `roles_tenant_property_key_uq` allows both, and `listRolesAtProperty()`
   * already returns exactly that set.
   *
   * With the head count, which is not decoration: `request_types.route_to_role_key`
   * routes to whoever holds a role here, so a role nobody holds means requests
   * sitting OPEN for ever with a `NOBODY_WITH_ROLE` event nobody reads.
   */
  const roleOptions: RoleOption[] = roles.map((role) => ({
    key: role.key,
    name: role.name,
    staffCount: role.staffCount,
  }));

  const views: StaffView[] = staff.map((member) => ({
    id: member.id,
    email: member.email,
    fullName: member.fullName,
    phone: member.phone,
    status: member.status,
    /**
     * A date, not a timestamp, and in the PROPERTY's zone. "Last seen 14 Mar" is
     * what a manager is actually asking; the minute is noise and the server's
     * clock would be wrong (CLAUDE.md "Dates").
     */
    lastSeen: member.lastLoginAt ? formatFolioDate(member.lastLoginAt, timeZone) : null,
    roleKeys: member.roleKeys,
    roleNames: member.roleKeys.map(
      (key) => roles.find((role) => role.key === key)?.name ?? key,
    ),
    inviteLive: member.inviteLive,
    /** So the screen can refuse to draw a "switch yourself off" button. */
    isYou: member.id === session.staffUserId,
  }));

  const active = views.filter((member) => member.status === 'ACTIVE').length;
  const waiting = views.filter((member) => member.status === 'INVITED').length;

  return (
    <AdminShell
      session={session}
      propertyId={propertyId}
      propertyName={property?.name ?? 'This property'}
      current="staff"
    >
      <header className={styles.pageHead}>
        <div>
          <h1 className={styles.title}>Staff</h1>
          <p className={styles.lede}>
            {active} {active === 1 ? 'person' : 'people'} working
            {waiting > 0 ? ` · ${waiting} not signed in yet` : ''}
          </p>
        </div>
      </header>

      <StaffBoard
        propertyId={propertyId}
        staff={views}
        roles={roleOptions}
        permissions={{
          invite: can(session, propertyId, 'staff:invite'),
          update: can(session, propertyId, 'staff:update'),
          deactivate: can(session, propertyId, 'staff:deactivate'),
          assignRole: can(session, propertyId, 'role:assign'),
        }}
      />

      <p className={styles.footnote}>
        An invite link sets a password and works once, for three days. It is
        stored hashed and never shown again — if it is lost, send another. A
        property is never left without an active property admin: the last one
        cannot be switched off, and cannot have the role taken away.
      </p>
    </AdminShell>
  );
}
