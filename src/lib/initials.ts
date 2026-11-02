/**
 * "Meena Joshi" → "MJ", "Meena" → "ME". For an avatar beside a name.
 *
 * Its own module with no 'use client', because server components (Team
 * today) and client components (the live request list) both render it — a
 * client module's exports are references on the server, not functions, and
 * calling one there throws.
 */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] : parts[0]?.[1] ?? '')).toUpperCase();
}
