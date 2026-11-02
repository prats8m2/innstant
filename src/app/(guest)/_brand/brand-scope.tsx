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
 * It also carries the property's guest theme (D-100): `data-guest-theme`
 * picks the --g-* colours, and `data-theme="kesari"` is repeated here so
 * theme.css's role names recompute from them on THIS element — a var()
 * resolves where it is declared, and the layout's own data-theme sits above
 * the theme choice. So this is a box now, not `display: contents`: it paints
 * the theme's page colour over the layout's default one. It adds no padding
 * or positioning, so the fixed order bar and the sticky headers are unmoved.
 *
 * No session (the scan redirect, an expired cookie) is the theme's own
 * saffron, never an error: branding is cosmetic and must not stand between a
 * guest and the menu (#9).
 */
export async function BrandScope({ children }: { children: React.ReactNode }) {
  const branding = await guestBranding();
  return (
    <div
      data-theme="kesari"
      data-guest-theme={branding.theme}
      className={styles.scope}
      style={brandingStyle(branding) as React.CSSProperties}
    >
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
