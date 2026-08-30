/**
 * Cookie names and options ONLY. No imports, no Node built-ins.
 *
 * This file exists because `src/middleware.ts` runs on the EDGE runtime, and
 * importing it from `sessions.ts` dragged `node:crypto` into the edge bundle
 * and broke the build. The split is the fix and also the reminder: anything the
 * middleware touches must be edge-safe, which in practice means it must be
 * inert. Session resolution stays server-side.
 */
export const STAFF_SESSION_COOKIE = 'hgs_staff';

/** 12 hours — a full shift plus a handover, but not so long that a kitchen
 *  screen left logged in overnight is a standing invitation. */
export const SESSION_TTL_HOURS = 12;

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: SESSION_TTL_HOURS * 3600,
};
