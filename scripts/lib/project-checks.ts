/**
 * The project's verifiable facts, in one place.
 *
 * `pnpm status` prints these to a terminal and `pnpm quality` renders them in
 * a browser. They were written for the first and copied into the second for
 * about a day, which is exactly how two copies of an RLS check start
 * disagreeing about whether RLS is on. One source now; both tools import it.
 *
 * Nothing here runs a gate. These are cheap reads — a connection, a few
 * catalog queries, four `existsSync` calls — safe to do on every page load.
 * Running `tsc` is the other half of the job and it lives in
 * `scripts/quality/registry.ts`, because it costs seconds rather than
 * milliseconds and nothing should do it without being asked.
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dbSsl } from '@/db/ssl';

/** `ok: null` means "reported, not judged" — a count, or a thing not needed yet. */
export type Check = { label: string; ok: boolean | null; detail: string };

/** Optional service keys. Absent is fine; the product works without them. */
export const OPTIONAL_KEYS = [
  'R2_ACCESS_KEY_ID', 'RAZORPAY_KEY_ID', 'SMS_PROVIDER_KEY', 'GOOGLE_PLACES_API_KEY',
] as const;

/** A shell command's stdout, or '' if it fails. Never throws. */
export const sh = (cmd: string): string => {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};


/** Reads `.env` directly: this runs outside Next, which is what loads it. */
export function loadEnv(): Record<string, string> {
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

/**
 * The tenancy invariants, asked of the live database.
 *
 * CLAUDE.md #2 in particular: if the app connects as anything but `app_user`,
 * or `app_user` owns a table, RLS is decorative and every other guarantee in
 * this product rests on nothing.
 */
export async function checkDatabase(env: Record<string, string>): Promise<Check[]> {
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

/**
 * S8. The parts of a deploy that are visible from here.
 *
 * Deliberately narrow: this cannot tell you whether Railway is serving, only
 * whether the repo is wired up to get there. The one assertion that matters —
 * a phone on mobile data scanning a printed code — is not automatable and is
 * written down in docs/DEPLOYMENT.md instead.
 */

export function checkDeploy(): Check[] {
  const remote = sh('git remote get-url origin');
  const upstream = sh('git rev-parse --abbrev-ref --symbolic-full-name @{u}');
  const branch = sh('git rev-parse --abbrev-ref HEAD');

  return [
    {
      label: 'git remote',
      ok: !!remote,
      detail: remote || 'none — CI cannot run and Railway has nothing to deploy from',
    },
    {
      label: 'branch tracks a remote',
      ok: !!upstream,
      detail: upstream || `${branch} is local only (\`git push -u origin ${branch}\`)`,
    },
    {
      label: 'CI workflow',
      ok: existsSync('.github/workflows/ci.yml'),
      detail: existsSync('.github/workflows/ci.yml') ? 'checks · integration · e2e' : 'missing',
    },
    {
      label: 'deploy image',
      ok: existsSync('Dockerfile') && existsSync('railway.json'),
      detail:
        existsSync('Dockerfile') && existsSync('railway.json')
          ? 'Dockerfile + railway.json (healthcheck /api/health)'
          : 'missing Dockerfile or railway.json',
    },
  ];
}

/**
 * A fingerprint of the working tree, for deciding whether a result is stale.
 *
 * The commit alone is not enough: most of the time a result is produced
 * against a dirty tree, and "dirty" as a boolean would mark every run stale
 * the moment it finished — a badge that is always on says nothing.
 *
 * Content-level for tracked files (the diff against HEAD, hashed by git
 * itself so the output stays 40 bytes however large the change), and
 * name-level for untracked ones. The gap that leaves is real and small:
 * editing an untracked file that no check reads will not re-stale a result.
 * Closing it would mean reading every untracked file on every page load.
 */
export function treeHash(): string {
  const porcelain = sh('git status --porcelain');
  const diff = sh('git diff HEAD | git hash-object --stdin');
  return createHash('sha256').update(porcelain).update(diff).digest('hex').slice(0, 12);
}

/**
 * Where DATABASE_URL actually points, with the credentials left out.
 *
 * The integration suite provisions tenants into whatever this resolves to,
 * and on a developer machine that is quite often the production database —
 * docs/STATUS.md has carried a warning about exactly this for two sessions.
 * A command you have to type gives you a moment to think; a button does not,
 * so the button has to say where it is aiming.
 *
 * Host and database name only. Never the user, never the password: this is
 * rendered in a browser and may end up in a screenshot.
 */
export function databaseTarget(env: Record<string, string>): {
  host: string; database: string; local: boolean;
} | null {
  const url = env.DATABASE_URL;
  if (!url || url.includes('...')) return null;
  try {
    const u = new URL(url);
    const host = u.hostname;
    return {
      host: u.port ? `${host}:${u.port}` : host,
      database: u.pathname.replace(/^\//, '') || '(default)',
      local: host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local'),
    };
  } catch {
    return null;
  }
}
