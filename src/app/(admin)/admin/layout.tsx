import { withTenant } from '@/db';
import { findProperty } from '@/modules/identity';
import { adminAccess, AdminDenied } from './guard';
import { AdminShell } from './admin-shell';

/**
 * The ops console's frame, as a LAYOUT.
 *
 * It used to be a component every page wrapped itself in, deliberately, so
 * the sign-in and invite pages would not get a rail. Those two now live in
 * their own route group, `(staff-auth)`, with the same URLs, and the console
 * can have a real layout. What that buys:
 *
 *  · The rail renders once and stays across navigations. Before, every page
 *    rebuilt it, and the bell closed and reopened its live stream on every
 *    click.
 *
 * There is deliberately NO `loading.tsx` under it. One was built and taken
 * out: with a Suspense boundary the page streams in behind the placeholder,
 * and for up to a second the real content sits twice in the DOM (once in
 * place, once in React's hidden `<div id="S:n">`) and the board answers the
 * keyboard later than it looks ready. Four e2e tests caught both. The menu
 * item's own spinner (`NavPending`) says a click was heard instead.
 *
 * Signed in or not is decided here (no session redirects to sign-in, D-045),
 * and each page still checks its own permission, as each action does. A
 * layout is not re-run on every navigation, so it must never be the only
 * check.
 */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const access = await adminAccess();
  if (!access.ok) return <AdminDenied reason={access.reason} framed />;
  const { session, propertyId } = access;

  const property = await withTenant(
    { tenantId: session.tenantId, propertyId },
    (tx) => findProperty(tx, propertyId),
  );

  return (
    <AdminShell
      session={session}
      propertyId={propertyId}
      propertyName={property?.name ?? 'This property'}
    >
      {children}
    </AdminShell>
  );
}
