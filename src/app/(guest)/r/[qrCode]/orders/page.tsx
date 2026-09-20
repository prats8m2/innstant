import { permanentRedirect } from 'next/navigation';

/**
 * `/orders` was the food-only list before amenities joined it (D-058).
 *
 * It is kept as a redirect rather than deleted because a guest may have the URL
 * open on a phone that has been in a pocket since yesterday, and because it was
 * live on the demo before the move. `permanentRedirect` (308) rather than
 * `redirect` (307): the old path is not coming back, and a browser is welcome
 * to remember that.
 */
export default async function OrdersRedirect({
  params,
}: {
  params: Promise<{ qrCode: string }>;
}) {
  const { qrCode } = await params;
  permanentRedirect(`/r/${encodeURIComponent(qrCode)}/activity`);
}
