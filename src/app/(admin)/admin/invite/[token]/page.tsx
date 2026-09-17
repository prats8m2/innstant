import { withTenant } from '@/db';
import { describeInvite, findProperty } from '@/modules/identity';
import { AcceptForm } from './accept-form';
import { staffTenantId } from '../../login/tenant';
import styles from '../../login/login.module.css';

/**
 * Accepting an invite: the second and last unauthenticated page on a staff
 * surface.
 *
 * `provisionProperty()` creates a PROPERTY_ADMIN as INVITED with no password,
 * and S5 never built this page — so the only account that could ever sign in was
 * one the demo seeder wrote a password for. P3.5.
 *
 * ─── Which tenant, before anybody is signed in ─────────────────────────────
 *
 * The same open question `/admin/login` already documents, answered the same
 * way. `login()` needs a tenant and so does this, and how a browser establishes
 * which tenant it is talking to is part of the tenancy model — CLAUDE.md says
 * ask before changing that. `STAFF_TENANT_ID` is the explicit stopgap for the
 * single-tenant deployment, and whichever of the two real answers is chosen
 * (subdomain, or a SECURITY DEFINER email→tenant lookup) this page changes in
 * exactly the same one line the login action does.
 *
 * It deliberately does NOT add a third unscoped query. `resolve_qr_routing()`
 * and `sla_sweep_properties()` are the only two in the product and each is
 * documented as such; the invite token is looked up under `withTenant()` like
 * everything else, and RLS confines it.
 */
export const dynamic = 'force-dynamic';

export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const tenantId = staffTenantId();

  const found = tenantId
    ? await withTenant({ tenantId }, async (tx) => {
      const invite = await describeInvite(tx, token);
      if (!invite) return null;
      return {
        invite,
        property: await findProperty(tx, invite.propertyId),
      };
    })
    : null;

  /**
   * One message for every failure — unknown, expired, revoked, already used.
   * Somebody probing this URL learns nothing from which, and the person holding
   * a real link needs the same instruction either way: ask for a new one.
   */
  if (!found) {
    return (
      <main className={styles.shell}>
        <div className={styles.card}>
          <h1 className={styles.title}>This link has expired</h1>
          <p className={styles.error} role="alert">
            Invite links work once, and for three days. Ask whoever invited you
            to send another.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>{found.property?.name ?? 'Staff'}</p>
        <h1 className={styles.title}>Welcome, {found.invite.fullName}</h1>
        <AcceptForm token={token} email={found.invite.email} />
      </div>
    </main>
  );
}
