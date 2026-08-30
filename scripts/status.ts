/**
 * `pnpm status` — verified project state.
 *
 * docs/STATUS.md carries the narrative: where we are, what is next, what is
 * blocked. This script carries the FACTS, re-derived on every run: which
 * commit, whether the gates actually pass, whether the database is reachable
 * and correctly configured.
 *
 * The split is deliberate. A hand-maintained status file goes stale silently,
 * and a stale one is worse than none — it is the same failure mode as a
 * `WHERE tenant_id` that someone forgot to update. Read STATUS.md for intent;
 * run this for truth.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dbSsl } from '@/db/ssl';

type Check = { label: string; ok: boolean | null; detail: string };

const sh = (cmd: string): string => {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

const quiet = (cmd: string): boolean => {
  try {
    execSync(cmd, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

function loadEnv(): Record<string, string> {
  if (!existsSync('.env')) return {};
  return Object.fromEntries(
    readFileSync('.env', 'utf8')
      .split('\n')
      .filter((l) => /^[A-Z0-9_]+=/.test(l))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')] as const;
      }),
  );
}

async function checkDatabase(env: Record<string, string>): Promise<Check[]> {
  const out: Check[] = [];
  const url = env.DATABASE_URL;
  const migrationUrl = env.DATABASE_MIGRATION_URL;

  if (!url || url.includes('...')) {
    return [{ label: 'database', ok: false, detail: 'DATABASE_URL unset or still a placeholder' }];
  }

  const role = (u: string): string => {
    try {
      return new URL(u).username;
    } catch {
      return '?';
    }
  };

  // CLAUDE.md #2 — the app connects as app_user, migrations as the owner.
  out.push({
    label: 'DATABASE_URL role',
    ok: role(url) === 'app_user',
    detail: `${role(url)}${role(url) === 'app_user' ? '' : ' — MUST be app_user, or RLS is decorative (CLAUDE.md #2)'}`,
  });
  out.push({
    label: 'DATABASE_MIGRATION_URL role',
    ok: !!migrationUrl && !migrationUrl.includes('...') && role(migrationUrl) !== 'app_user',
    detail: migrationUrl?.includes('...') ? 'placeholder' : `${role(migrationUrl ?? '')} (owner)`,
  });

  let pg: typeof import('pg') | undefined;
  try {
    pg = await import('pg');
  } catch {
    out.push({ label: 'database reachable', ok: null, detail: 'pg not installed yet' });
    return out;
  }

  const ssl = dbSsl(url);
  const client = new pg.default.Client({
    connectionString: url,
    ssl,
    connectionTimeoutMillis: 10_000,
  });
  try {
    await client.connect();
    const v = await client.query<{ v: string }>("select current_setting('server_version') as v");
    out.push({
      label: 'database reachable',
      ok: true,
      detail: `PostgreSQL ${v.rows[0]?.v ?? '?'} (${ssl ? 'TLS' : 'no TLS, local host'})`,
    });

    const priv = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      `select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );
    const p = priv.rows[0];
    out.push({
      label: 'app_user is RLS-subject',
      ok: !!p && !p.rolsuper && !p.rolbypassrls,
      detail: p ? (p.rolsuper || p.rolbypassrls ? 'HAS SUPERUSER/BYPASSRLS — isolation is not enforced' : 'no superuser, no BYPASSRLS') : '?',
    });

    const t = await client.query<{ n: string }>(
      `select count(*) n from pg_tables where schemaname = 'public'`,
    );
    out.push({ label: 'public tables', ok: null, detail: `${t.rows[0]?.n ?? '?'}` });

    const owned = await client.query<{ n: string }>(
      `select count(*) n from pg_tables where schemaname='public' and tableowner = current_user`,
    );
    out.push({
      label: 'tables owned by app_user',
      ok: owned.rows[0]?.n === '0',
      detail: `${owned.rows[0]?.n ?? '?'} (must be 0 — owners bypass RLS silently)`,
    });
  } catch (e) {
    out.push({
      label: 'database reachable',
      ok: false,
      detail: e instanceof Error ? e.message.slice(0, 100) : 'unknown error',
    });
  } finally {
    await client.end().catch(() => {});
  }
  return out;
}

async function main(): Promise<void> {
  const env = loadEnv();

  const gitLine = sh('git log -1 --format=%h %s') || '(no commits)';
  const dirty = sh('git status --porcelain');
  const branch = sh('git rev-parse --abbrev-ref HEAD') || '(none)';

  console.log('\n\x1b[1mPROJECT STATUS\x1b[0m  ·  hotel guest services');
  console.log('─'.repeat(64));
  console.log(`branch      ${branch}`);
  console.log(`head        ${gitLine.replace(' ', '  ')}`);
  console.log(`worktree    ${dirty ? `${dirty.split('\n').length} uncommitted change(s)` : 'clean'}`);
  console.log(`node        ${process.version}  (repo pins ${existsSync('.nvmrc') ? readFileSync('.nvmrc', 'utf8').trim() : '?'})`);

  console.log('\n\x1b[1mGATES\x1b[0m  (CLAUDE.md: definition of done)');
  console.log('─'.repeat(64));
  const gates: Check[] = [
    { label: 'typecheck', ok: quiet('pnpm -s typecheck'), detail: 'tsc --noEmit' },
    { label: 'lint', ok: quiet('pnpm -s lint'), detail: 'eslint .' },
    { label: 'test', ok: quiet('pnpm -s test'), detail: 'vitest run' },
  ];
  for (const g of gates) {
    console.log(`  ${g.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${g.label.padEnd(24)} ${g.detail}`);
  }

  console.log('\n\x1b[1mENVIRONMENT\x1b[0m');
  console.log('─'.repeat(64));
  for (const c of await checkDatabase(env)) {
    const mark = c.ok === null ? '\x1b[90m·\x1b[0m' : c.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    console.log(`  ${mark} ${c.label.padEnd(28)} ${c.detail}`);
  }
  const optional = ['R2_ACCESS_KEY_ID', 'RAZORPAY_KEY_ID', 'SMS_PROVIDER_KEY', 'GOOGLE_PLACES_API_KEY'];
  const unset = optional.filter((k) => !env[k]);
  if (unset.length) console.log(`  \x1b[90m·\x1b[0m ${'not needed yet'.padEnd(28)} ${unset.join(', ')}`);

  console.log('\n\x1b[1mPOSITION\x1b[0m');
  console.log('─'.repeat(64));
  const status = existsSync('docs/STATUS.md') ? readFileSync('docs/STATUS.md', 'utf8') : '';
  const now = /^## +Now *\n([\s\S]*?)(?=\n## |\n---)/m.exec(status);
  if (now?.[1]?.trim()) {
    console.log(now[1].trim().split('\n').map((l) => '  ' + l).join('\n'));
  } else {
    // Loud on purpose: a status file that cannot be read is the same failure
    // as one that is stale, and this is the line a new session reads first.
    console.log('  \x1b[31m! docs/STATUS.md has no readable "## Now" section — fix it before continuing.\x1b[0m');
  }
  console.log('\n  Full history and next steps: docs/STATUS.md');
  console.log('  Session prompts:              docs/P0-TASKS.md\n');
}

await main();
