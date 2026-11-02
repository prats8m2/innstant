'use server';

import { z } from 'zod';
import { withTenant } from '@/db';
import { requireStaffSession } from '@/lib/auth-context';
import { NotFoundError } from '@/lib/errors';
import { looksLikeName, normaliseQuery, orderNeedle, SEARCH_MAX_LENGTH } from '@/lib/search';
import {
  can, CONSOLE_APPEARANCES, findProperty, searchRooms, setConsoleAppearance,
} from '@/modules/identity';
import { searchGuests } from '@/modules/stay';
import { searchOrders } from '@/modules/ordering';

/**
 * The console frame's two server calls: the person's light or dark, and the
 * search behind ⌘K. Both act for the signed-in person only.
 */

/* ── Appearance ─────────────────────────────────────────────────────────── */

const Appearance = z.object({ appearance: z.enum(CONSOLE_APPEARANCES) });

/**
 * Save this person's console look. There is no staff id in the input: the
 * account changed is the session's own, so nobody can set somebody else's.
 * The screen has already switched by the time this lands; this makes it stick
 * on the next sign-in, on any machine.
 */
export async function saveConsoleAppearance(input: unknown): Promise<void> {
  const { appearance } = Appearance.parse(input);
  const session = await requireStaffSession();
  await withTenant(
    { tenantId: session.tenantId },
    (tx) => setConsoleAppearance(tx, { staffUserId: session.staffUserId, appearance }),
  );
}

/* ── Search ─────────────────────────────────────────────────────────────── */

export type SearchKind = 'room' | 'guest' | 'order';

export interface SearchResult {
  kind: SearchKind;
  id: string;
  title: string;
  detail: string;
  href: string;
}

export interface SearchAnswer {
  /** The query these results are for, normalised, so a slow answer to an
   *  older query can be recognised and dropped. */
  query: string;
  results: SearchResult[];
  /** Which kinds this person may search at all, for the empty state. */
  kinds: SearchKind[];
}

const Search = z.object({
  propertyId: z.uuid(),
  query: z.string().max(SEARCH_MAX_LENGTH * 4),
});

const STATUS_WORDS: Record<string, string> = {
  PLACED: 'placed', ACCEPTED: 'accepted', PREPARING: 'cooking', READY: 'at the pass',
  OUT_FOR_DELIVERY: 'on the way', DELIVERED: 'delivered', CLOSED: 'closed',
  REJECTED: 'rejected', CANCELLED: 'cancelled', DISPUTED: 'disputed',
};

/**
 * Rooms by number, guests by name and orders by number, at this property,
 * and only the kinds this person may open: rooms need the key rack
 * (`stay:read`), guests their page (`guest:read`), orders the floor
 * (`order:read`). Each result links to a page that already exists.
 *
 * Read-only, one tenant transaction, five of each at most.
 */
export async function searchConsole(input: unknown): Promise<SearchAnswer> {
  const { propertyId, query: raw } = Search.parse(input);
  const session = await requireStaffSession();
  // Same answer as a property this person cannot see anywhere else: 404.
  if (!session.properties.has(propertyId)) {
    throw new NotFoundError('That is no longer available.', {
      detail: 'search at a property not visible to this session',
      staffUserId: session.staffUserId,
      propertyId,
    });
  }

  const mayRooms = can(session, propertyId, 'stay:read');
  const mayGuests = can(session, propertyId, 'guest:read');
  const mayOrders = can(session, propertyId, 'order:read');
  const kinds: SearchKind[] = [
    ...(mayRooms ? ['room' as const] : []),
    ...(mayGuests ? ['guest' as const] : []),
    ...(mayOrders ? ['order' as const] : []),
  ];

  const query = normaliseQuery(raw);
  if (!query) return { query, results: [], kinds };
  const needle = orderNeedle(query);

  const found = await withTenant({ tenantId: session.tenantId, propertyId }, async (tx) => ({
    rooms: mayRooms ? await searchRooms(tx, { propertyId, query }) : [],
    guests: mayGuests && looksLikeName(query) ? await searchGuests(tx, { propertyId, query }) : [],
    orders: mayOrders && needle ? await searchOrders(tx, { propertyId, needle }) : [],
    timeZone: mayGuests ? (await findProperty(tx, propertyId))?.timezone : undefined,
  }));

  const day = new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: found.timeZone ?? 'Asia/Kolkata',
  });

  const results: SearchResult[] = [
    ...found.rooms.map((room) => ({
      kind: 'room' as const,
      id: room.id,
      title: `Room ${room.number}`,
      detail: room.floorName,
      href: `/admin/rooms?room=${encodeURIComponent(room.number)}`,
    })),
    ...found.guests.map((guest) => ({
      kind: 'guest' as const,
      id: guest.id,
      title: guest.fullName,
      detail: guest.inRoom ? `In room ${guest.inRoom}` : `Last stay ${day.format(guest.lastStayAt)}`,
      href: `/admin/guests/${guest.id}`,
    })),
    ...found.orders.map((order) => ({
      kind: 'order' as const,
      id: order.id,
      title: `Order ${order.orderNumber}`,
      detail: [order.destination, STATUS_WORDS[order.status] ?? order.status.toLowerCase()]
        .filter(Boolean).join(' · '),
      /* There is no page per order. A room's order opens that room at the
         desk, where its live orders and its bill are; a table's or a
         takeaway's (D-079) opens the live floor, which is where those are. */
      href: order.roomId && mayRooms
        ? `/admin/desk?room=${order.roomId}`
        : '/admin/floor',
    })),
  ];

  return { query, results, kinds };
}
