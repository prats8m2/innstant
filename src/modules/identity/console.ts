import { and, asc, eq, ilike, isNull, sql } from 'drizzle-orm';
import type { Tx } from '@/db';
import { floors, properties, rooms, staffUsers } from '@/db/schema/identity';
import { NotFoundError } from '@/lib/errors';
import { likePrefix } from '@/lib/search';
import { readBranding, type GuestThemeKey } from './branding';
import {
  DEFAULT_CONSOLE_APPEARANCE, isConsoleAppearance, type ConsoleAppearance,
} from './console-appearance';

/**
 * What the console's frame shows around every page: the property, the person
 * signed in, and how the console looks to them.
 *
 * Read once by the console's layout, in the same tenant transaction, so the
 * frame costs one round trip rather than four.
 */
export interface ConsoleChrome {
  propertyName: string;
  city: string | null;
  /** Rooms in service. The sidebar's "Udaipur · 34 rooms". */
  roomCount: number;
  /** The property's guest theme, which picks the console's accent (D-100). */
  theme: GuestThemeKey;
  /** This person's light, dark or follow-the-device (migration 0017). */
  appearance: ConsoleAppearance;
  /** The roles this person holds HERE, by name ("General manager"). */
  roleNames: string[];
}

export async function consoleChrome(
  tx: Tx,
  input: { propertyId: string; staffUserId: string },
): Promise<ConsoleChrome> {
  const [property] = await tx
    .select({ name: properties.name, city: properties.city, branding: properties.branding })
    .from(properties)
    .where(eq(properties.id, input.propertyId))
    .limit(1);

  const [person] = await tx
    .select({ appearance: staffUsers.consoleAppearance })
    .from(staffUsers)
    .where(eq(staffUsers.id, input.staffUserId))
    .limit(1);

  const [count] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(rooms)
    .where(and(eq(rooms.propertyId, input.propertyId), isNull(rooms.archivedAt)));

  /* Raw for the join across the role tables, like listRolesAtProperty(). */
  const held = await tx.execute<{ name: string }>(sql`
    SELECT DISTINCT r.name
    FROM staff_property_roles spr
    JOIN roles r ON r.id = spr.role_id
    WHERE spr.staff_user_id = ${input.staffUserId}
      AND spr.property_id = ${input.propertyId}
    ORDER BY r.name
  `);

  return {
    propertyName: property?.name ?? 'This property',
    city: property?.city ?? null,
    roomCount: Number(count?.n ?? 0),
    theme: readBranding(property?.branding).theme,
    appearance: isConsoleAppearance(person?.appearance)
      ? person.appearance
      : DEFAULT_CONSOLE_APPEARANCE,
    roleNames: held.rows.map((row) => row.name),
  };
}

/**
 * A person changes their OWN console's look.
 *
 * The caller passes the signed-in session's id and nothing else can reach
 * here: there is no staff id in the request, so nobody can set somebody
 * else's. A preference, not a status: no event (#7 is for status changes).
 */
export async function setConsoleAppearance(
  tx: Tx,
  input: { staffUserId: string; appearance: ConsoleAppearance },
): Promise<void> {
  const updated = await tx
    .update(staffUsers)
    .set({ consoleAppearance: input.appearance, updatedAt: new Date() })
    .where(eq(staffUsers.id, input.staffUserId))
    .returning({ id: staffUsers.id });
  if (updated.length === 0) {
    throw new NotFoundError('That account is no longer available.', {
      staffUserId: input.staffUserId,
    });
  }
}

export interface RoomHit {
  id: string;
  number: string;
  floorName: string;
}

/**
 * Rooms whose number starts with what was typed: "2" finds the second floor,
 * "214" finds 214. In service only — the console's search is for the floor
 * as it is today, and setup lists the rest.
 */
export async function searchRooms(
  tx: Tx,
  input: { propertyId: string; query: string; limit?: number },
): Promise<RoomHit[]> {
  const term = input.query.trim();
  if (!term) return [];
  return tx
    .select({ id: rooms.id, number: rooms.number, floorName: floors.name })
    .from(rooms)
    .innerJoin(floors, eq(floors.id, rooms.floorId))
    .where(and(
      eq(rooms.propertyId, input.propertyId),
      isNull(rooms.archivedAt),
      ilike(rooms.number, likePrefix(term)),
    ))
    // Shortest first, so "21" puts 21 (if there is one) above 210–219.
    .orderBy(sql`length(${rooms.number})`, asc(rooms.number))
    .limit(input.limit ?? 5);
}
