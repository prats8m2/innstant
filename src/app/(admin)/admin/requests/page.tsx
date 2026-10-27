import { withTenant } from '@/db';
import { adminAccess, AdminDenied } from '../guard';
import { can, listRolesAtProperty } from '@/modules/identity';
import { getAdminRequestTypes } from '@/modules/requests';
import { RequestTypeEditor } from './request-type-editor';

/**
 * What a guest may ask for, and what the hotel promises back.
 *
 * `request_types` has been the property-configurable catalog since S6 —
 * DATA-MODEL §7 says the ops team self-serves rather than filing a ticket with
 * us — and until this screen the only way to change "towels in 12 minutes" was
 * to edit `provision.ts` and re-run the seeder, which also wipes the property.
 *
 * Four columns on this screen are read by something that matters and by nothing
 * a manager could see: `sla_minutes` is what the SLA sweep escalates against,
 * `route_to_role_key` is what the auto-router matches on, `price_minor` is what
 * decides whether a guest meets the one verification prompt, and `is_active` is
 * what takes a thing off the guest's list for the season.
 */
export const dynamic = 'force-dynamic';

export default async function RequestTypesAdmin() {
  /**
   * `request:read` to look, `request_type:manage` to change — the same split
   * the menu editor makes with `catalog:read` and `catalog:manage`. There is no
   * `request_type:read`, and inventing one would be the wrong shape: a
   * housekeeper wondering why towels are twelve minutes should be able to find
   * out, and nothing here is a secret from somebody already working the floor.
   */
  const access = await adminAccess('request:read');
  if (!access.ok) return <AdminDenied reason={access.reason} />;
  const { session, propertyId } = access;

  const { types, roles } = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => ({
      types: await getAdminRequestTypes(tx, { propertyId }),
      // With the headcount, so routing at a role nobody holds is visible on the
      // form rather than discovered as requests that are never assigned.
      roles: await listRolesAtProperty(tx, { propertyId }),
    }),
  );

  return (
    <>
      <RequestTypeEditor
        propertyId={propertyId}
        types={types}
        roles={roles}
        mayManage={can(session, propertyId, 'request_type:manage')}
      />
    </>
  );
}
