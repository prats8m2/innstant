import { mediaStorage, mediaKey, parseMediaPath } from '@/modules/media';

/**
 * An uploaded picture, served (D-093).
 *
 * The bucket is private — Railway buckets have no public access — so the app
 * reads the object and hands it over. Not a redirect to a presigned URL: those
 * expire, so a browser could never keep a copy, and every menu would fetch
 * every photo again.
 *
 * Public, with no session: these are the pictures on a guest's menu, and the
 * id is a random uuid nobody can guess. A path is never reused — replacing a
 * picture uploads a new one under a new id — so a browser may keep each one
 * for a year without asking again.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const YEAR = 60 * 60 * 24 * 365;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; file: string }> },
): Promise<Response> {
  const { id, file } = await params;
  const parsed = parseMediaPath(`/media/${id}/${file}`);
  if (!parsed) return new Response('Not found', { status: 404 });

  const body = await mediaStorage().get(mediaKey(parsed.id, parsed.width));
  if (!body) return new Response('Not found', { status: 404 });

  return new Response(new Uint8Array(body), {
    headers: {
      'content-type': 'image/webp',
      'content-length': String(body.length),
      'cache-control': `public, max-age=${YEAR}, immutable`,
      'x-content-type-options': 'nosniff',
    },
  });
}
