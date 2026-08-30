/**
 * `pnpm db:migrate`
 *
 * Runs as the OWNER role via DATABASE_MIGRATION_URL — never as app_user
 * (CLAUDE.md #2). app_user owns nothing and lacks BYPASSRLS, which is the only
 * reason the RLS policies in 0001 are load-bearing rather than decorative.
 *
 * Order matters: the generated schema, then RLS, then constraints. 0001
 * verifies its own coverage and raises if any table was left unprotected.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { dbSsl } from './ssl';

const MIGRATIONS_DIR = join(process.cwd(), 'src/db/migrations');

function requireOwnerUrl(): string {
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url || url.includes('...')) {
    throw new Error(
      'DATABASE_MIGRATION_URL is unset. Migrations run as the owner role; ' +
        'pointing this at app_user would fail, and pointing the APP at the ' +
        'owner would silently disable RLS. See CLAUDE.md #2.',
    );
  }
  if (new URL(url).username === 'app_user') {
    throw new Error(
      'DATABASE_MIGRATION_URL is set to app_user. It must be the owner role — ' +
        'app_user owns no tables and cannot create them.',
    );
  }
  return url;
}

async function main(): Promise<void> {
  const url = requireOwnerUrl();
  const client = new pg.Client({ connectionString: url, ssl: dbSsl(url) });
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id serial PRIMARY KEY,
      name text NOT NULL UNIQUE,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

  const applied = new Set(
    (await client.query<{ name: string }>('SELECT name FROM __drizzle_migrations')).rows.map((r) => r.name),
  );

  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  · ${file} (already applied)`);
      continue;
    }
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    process.stdout.write(`  → ${file} ... `);
    try {
      // Each migration is one transaction: it applies completely or not at all.
      await client.query('BEGIN');
      // Drizzle separates statements with this marker; raw files run whole.
      for (const stmt of sql.split('--> statement-breakpoint')) {
        if (stmt.trim()) await client.query(stmt);
      }
      await client.query('INSERT INTO __drizzle_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log('applied');
      ran += 1;
    } catch (e) {
      await client.query('ROLLBACK');
      console.log('FAILED');
      throw e;
    }
  }

  const { rows } = await client.query<{ n: string }>(
    `SELECT count(*) n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity`,
  );
  console.log(`\n${ran} migration(s) applied. ${rows[0]?.n} tables with RLS enabled and forced.`);

  await client.end();
}

await main();
