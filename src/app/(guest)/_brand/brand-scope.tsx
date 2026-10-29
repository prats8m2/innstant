import { cache } from 'react';
import { cookies } from 'next/headers';
import { withTenant } from '@/db';
import { resolveGuestSession, GUEST_SESSION_COOKIE } from '@/modules/access';
import {
  getPropertyProfile, brandingStyle, NO_BRANDING, type PropertyBranding,
} from '@/modules/identity';
import styles from './brand-scope.module.css';

/**
 * The hotel's own accent, logo and cover on every guest screen (D-087).
 *
 * A wrapper rather than a change to `(guest)/layout.tsx`, because that layout
 * sits above the dynamic segment and cannot know whose hotel it is. This one
 * sits inside `/r/[qrCode]` and `/p/[code]`, reads the guest's session, and
 * redeclares the accent tokens for everything under it — see `brandingStyle()`
 * for why the aliases are redeclared too, not only the primitive.
 *
 * `display: contents`: it must not become a box. Every guest page's own `main`
 * is the layout, and a wrapper that took part in it would shift the fixed
 * order bar and the sticky headers.
 *
 * No session (the scan redirect, an expired cookie) is the theme's own
 * saffron, never an error: branding is cosmetic and must not stand between a
 * guest and the menu (#9).
 */
export async function BrandScope({ children }: { children: React.ReactNode }) {
  const branding = await guestBranding();
  return (
    <div className={styles.scope} style={brandingStyle(branding) as React.CSSProperties}>
      {children}
    </div>
  );
}

/** Memoised per request: the scope and a page that shows the logo share one read. */
export const guestBranding = cache(async (): Promise<PropertyBranding> => {
  const store = await cookies();
  const session = await resolveGuestSession(store.get(GUEST_SESSION_COOKIE)?.value);
  if (!session) return NO_BRANDING;
  const profile = await withTenant(
    { tenantId: session.tenantId, propertyId: session.propertyId },
    (tx) => getPropertyProfile(tx, session.propertyId),
  );
  return profile?.branding ?? NO_BRANDING;
});
