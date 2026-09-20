import { sql } from 'drizzle-orm';
import { withPlatformWrite, withTenant } from '@/db';
import { demoVisitors } from '@/db/schema/demo';
import { cleanVisitorName } from './visitor-name';

/**
 * The demo guest book.
 *
 * Somebody presses "See how it works" on the marketing site, gives a first
 * name, and gets dropped into the seeded property as if they were staying in
 * it. This records that they came.
 *
 * Deliberately the smallest module in the product: one function, one table, no
 * reads. There is no lead scoring, no email, no follow-up — a name and a
 * timestamp, which is what was asked for and all that is honest to collect from
 * somebody who has not been asked for anything else.
 */

export { cleanVisitorName };

export interface DemoVisitor {
  name: string;
  roomNumber?: string | null;
  userAgent?: string | null;
}

/**
 * Write the row. Never throws into the caller's face: a guest book failing must
 * not stop somebody seeing the demo, which is the entire point of the click.
 */
export async function recordDemoVisitor(visitor: DemoVisitor): Promise<void> {
  const name = cleanVisitorName(visitor.name);
  if (!name) return;

  await withPlatformWrite('demo visitor from the marketing site', (tx) =>
    tx.insert(demoVisitors).values({
      name,
      roomNumber: visitor.roomNumber ?? null,
      // Truncated: a user-agent string is not worth a text column's worth of
      // somebody else's browser trivia.
      userAgent: visitor.userAgent?.slice(0, 400) ?? null,
    }));
}

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Which room the marketing site's "See how it works" opens.
 *
 * Resolved every time rather than pinned in an env var, because `pnpm
 * demo:reset` reissues all 34 QR codes — a hardcoded public code is correct
 * until the first reseed and then 404s until somebody notices. Anything that
 * points at demo data has to be able to survive the demo data being rebuilt.
 *
 * Picks the lowest-numbered room that a scan would actually succeed on, which
 * is the same set of conditions `scanQrCode()` checks: a live sticker, a stay
 * that is checked in, and a checkout that has not already passed. Getting that
 * wrong lands a visitor on a 404 one click after "See how it works", which is
 * the worst place in the product to have one.
 *
 * The raw projection crosses into identity's and stay's tables, which D-001
 * forbids importing. It is the same narrow exception `scanQrCode()` takes for
 * the same reason: a read-only projection inside a tenant-scoped transaction,
 * parameterised, with RLS still applying to every row it touches.
 */
export async function resolveDemoRoomCode(): Promise<string | null> {
  const tenantId = process.env.DEMO_TENANT_ID ?? process.env.STAFF_TENANT_ID;
  if (!tenantId) return null;

  return withTenant({ tenantId }, async (tx) => {
    const found = await tx.execute<{ public_code: string }>(sql`
      SELECT q.public_code
      FROM room_qr_codes q
      JOIN rooms r ON r.id = q.room_id
      JOIN stays s ON s.room_id = r.id AND s.status = 'CHECKED_IN'
      WHERE q.revoked_at IS NULL
        AND s.scheduled_checkout_at > now()
      ORDER BY r.number
      LIMIT 1
    `);
    return found.rows[0]?.public_code ?? null;
  });
}

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * The two cookies the demo carries, and why neither is a credential.
 *
 * `DEMO_NAME_COOKIE` holds what to call the visitor. It is read by the guest
 * home to replace the seeded guest's name with theirs. Forging it changes a
 * greeting and nothing else.
 *
 * `DEMO_FLAG_COOKIE` marks the session as having come from the website rather
 * than from a sticker on a nightstand. It is what makes the home screen show a
 * demo ribbon and prefer the visitor's name.
 *
 * NEITHER GRANTS ANYTHING. The access tier that lets a demo visitor place an
 * order without the phone-digits prompt lives on the `guest_sessions` ROW, set
 * server-side in /demo/enter and written to `event_log` like every other tier
 * change. A visitor who hand-sets both cookies against a real hotel's QR code
 * gets a different name in a heading and the base tier they would have had
 * anyway. That separation is the whole design: the cosmetic half is a cookie
 * because it is cosmetic, and the half that matters is in Postgres.
 */
export const DEMO_NAME_COOKIE = 'hgs_demo_name';
export const DEMO_FLAG_COOKIE = 'hgs_demo';

/** Long enough that a visitor who comes back next week is not asked twice. */
export const DEMO_COOKIE_DAYS = 90;

export { openDemoSession } from './session';
export type { DemoSession } from './session';
