import { BrandScope } from '../../_brand/brand-scope';

/** The hotel's own accent on every screen below this one (D-087). */
export default function BrandedGuestLayout({ children }: { children: React.ReactNode }) {
  return <BrandScope>{children}</BrandScope>;
}
