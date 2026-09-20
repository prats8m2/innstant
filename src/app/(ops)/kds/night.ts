/**
 * Day or night, on the property's clock.
 *
 * Its own module with no `'use client'` on it, because BOTH sides need it: the
 * page resolves the opening scheme on the server so a night kitchen does not
 * flash white while it hydrates, and the board re-derives it on every tick so a
 * screen that has been on since lunch dims by itself at 19:00.
 *
 * It lived in `kitchen-board.tsx` first, which compiled clean and then threw
 * "Attempted to call isNight() from the server but isNight is on the client"
 * the first time the page was actually opened — a client module's exports are
 * references, not functions, once they cross the boundary.
 *
 * ─── Why not `prefers-color-scheme` ───────────────────────────────────────
 *
 * A kitchen tablet is bolted to a wall and nobody is going to change its
 * appearance setting at dusk, so the OS signal would leave the screen bright at
 * midnight or dim at noon. The hotel's own hours are the only thing that tracks
 * the room the screen is in.
 */

/** 19:00 to 07:00, property-local. The band the design uses. */
export function isNight(at: number, timeZone: string): boolean {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone })
      .format(new Date(at)),
  );
  return hour >= 19 || hour < 7;
}
