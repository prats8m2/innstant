import { NextResponse } from 'next/server';

/**
 * Health check. Route Handler, not a Server Action — this is called by
 * Railway and by uptime monitoring, i.e. a third party. See CLAUDE.md
 * "Conventions".
 *
 * S8 extends this with DB connectivity and migration state. It reports
 * `db: 'unchecked'` until then rather than claiming a health it has not
 * verified.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({
    status: 'ok',
    version: process.env.npm_package_version ?? '0.0.0',
    db: 'unchecked',
    migrations: 'unchecked',
    uptimeSeconds: Math.round(process.uptime()),
  });
}
