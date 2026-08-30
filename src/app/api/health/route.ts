import { NextResponse } from 'next/server';
import { pingDatabase } from '@/db';

/**
 * Health check. A Route Handler, not a Server Action — Railway and uptime
 * monitoring call this, and those are third parties (CLAUDE.md "Conventions").
 *
 * Reports database reachability honestly: a 503 when the database is down, so
 * Railway does not route traffic to a process that cannot serve a menu.
 * S8 adds migration state.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const db = await pingDatabase();
  return NextResponse.json(
    {
      status: db.ok ? 'ok' : 'degraded',
      version: process.env.npm_package_version ?? '0.0.0',
      db: db.ok ? 'up' : 'down',
      dbLatencyMs: db.latencyMs,
      uptimeSeconds: Math.round(process.uptime()),
    },
    { status: db.ok ? 200 : 503 },
  );
}
