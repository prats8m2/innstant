/**
 * Creates the `app_user` role on a database that does not have it yet.
 *
 * Production databases are set up once, by hand — this is for the ones that
 * are created and thrown away: the Postgres service container in CI, and a
 * local Postgres if you would rather not develop against the shared Railway
 * instance.
 *
 * It reproduces the property that makes RLS real (CLAUDE.md #2): app_user is a
 * plain LOGIN role. It is not a superuser, it has no BYPASSRLS, it owns no
 * tables, and it cannot create any. If CI ran its isolation tests as an owner
 * they would all pass and prove nothing.
 *
 * The table-level GRANTs are NOT here — they are in migration 0001, where they
 * belong, and they are why the role has to exist before migrations run.
 *
 *   DATABASE_MIGRATION_URL=... DATABASE_URL=... pnpm db:bootstrap
 */
import pg from 'pg';
import { dbSsl } from '@/db/ssl';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const ownerUrl = required('DATABASE_MIGRATION_URL');
  const appUrl = new URL(required('DATABASE_URL'));

  const role = decodeURIComponent(appUrl.username);
  const password = decodeURIComponent(appUrl.password);
  if (!role || !password) {
    throw new Error('DATABASE_URL must carry the app role and its password.');
  }
  if (role === 'postgres' || role === new URL(ownerUrl).username) {
    throw new Error(
      `DATABASE_URL points at "${role}", the owner role. The app must connect ` +
        'as a role that owns nothing, or RLS is decorative (CLAUDE.md #2).',
    );
  }

  const client = new pg.Client({ connectionString: ownerUrl, ssl: dbSsl(ownerUrl) });
  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
    // CREATE ROLE and GRANT take no bind parameters — a DO block does not
    // either, which is the first way this was written and it failed with an
    // opaque bind error. So both values are escaped by the driver instead:
    // escapeIdentifier for the name, escapeLiteral for the password.
    const roleIdent = client.escapeIdentifier(role);

    if (rowCount) {
      console.log(`  · role ${role} already exists`);
    } else {
      await client.query(
        `CREATE ROLE ${roleIdent} LOGIN PASSWORD ${client.escapeLiteral(password)}`,
      );
      console.log(`  → created role ${role}`);
    }

    const database = client.escapeIdentifier(appUrl.pathname.replace(/^\//, ''));
    await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${roleIdent}`);

    const { rows } = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1',
      [role],
    );
    const attrs = rows[0];
    if (attrs?.rolsuper || attrs?.rolbypassrls) {
      throw new Error(
        `${role} has SUPERUSER or BYPASSRLS. Every RLS policy in this schema ` +
          'would be silently ignored for it.',
      );
    }
    console.log(`  ✓ ${role} is RLS-subject (no superuser, no bypassrls)`);
  } finally {
    await client.end();
  }
}

await main();
