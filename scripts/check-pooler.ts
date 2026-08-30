/**
 * `pnpm db:check-pooler`
 *
 * CLAUDE.md #3 says PgBouncer runs in transaction pooling mode. That claim is
 * infrastructure, not code, so nothing in the repo proves it — and the failure
 * mode is silent: in SESSION mode a bare `SET` leaks between requests, which
 * means one guest's tenant context can serve another guest's request. This
 * script is the proof, and S4's leak test is meaningless without it passing.
 */
import pg from 'pg';

const ssl = { rejectUnauthorized: false } as const;
type Result = { ok: boolean | null; label: string; detail: string };
const results: Result[] = [];
const add = (ok: boolean | null, label: string, detail: string) => results.push({ ok, label, detail });

async function probe(name: string, url: string | undefined, expectPooled: boolean): Promise<void> {
  if (!url || url.includes('...') || url.includes('<')) {
    add(false, name, 'unset or still a placeholder');
    return;
  }
  const parsed = new URL(url);
  const client = new pg.Client({ connectionString: url, ssl, connectionTimeoutMillis: 10_000 });
  try {
    await client.connect();
  } catch (e) {
    add(false, name, e instanceof Error ? e.message.slice(0, 80) : 'connect failed');
    return;
  }

  try {
    // A bare SET that survives to the next query means we are on a session-
    // scoped connection: either direct Postgres, or PgBouncer in session mode.
    const probeValue = `pooler_probe_${process.pid}`;
    await client.query(`SET application_name = '${probeValue}'`);
    const seen = (await client.query<{ application_name: string }>('SHOW application_name'))
      .rows[0]?.application_name;
    const sessionScoped = seen === probeValue;

    if (expectPooled) {
      add(
        !sessionScoped,
        `${name} is behind a transaction pooler`,
        sessionScoped
          ? `NO — a bare SET persisted (port ${parsed.port}). This is a direct or session-mode connection; #3 is not satisfied.`
          : `yes — a bare SET did not persist (port ${parsed.port})`,
      );
    } else {
      add(
        sessionScoped,
        `${name} is a direct session`,
        sessionScoped ? `yes (port ${parsed.port})` : `NO — appears pooled (port ${parsed.port})`,
      );
    }

    // What actually matters: set_config(..., true) inside an explicit
    // transaction must apply within it and be gone after it. This is the
    // mechanism withTenant() relies on, and it must hold on every connection.
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', true)`);
    const inside = (await client.query<{ v: string }>(`SELECT current_setting('app.tenant_id', true) v`)).rows[0]?.v;
    await client.query('COMMIT');
    const outside = (await client.query<{ v: string }>(`SELECT current_setting('app.tenant_id', true) v`)).rows[0]?.v;

    add(
      inside === '00000000-0000-0000-0000-000000000001' && !outside,
      `${name}: set_config(local) applies then clears`,
      `inside='${inside ?? ''}' after-commit='${outside ?? ''}'`,
    );
  } finally {
    await client.end().catch(() => {});
  }
}

/** LISTEN/NOTIFY (D-015) cannot survive transaction pooling — the server
 *  connection is reassigned the moment the transaction ends. */
async function probeListen(url: string | undefined): Promise<void> {
  if (!url || url.includes('...') || url.includes('<')) {
    add(null, 'DATABASE_LISTEN_URL', 'not set — required before P1 realtime (D-015)');
    return;
  }
  const client = new pg.Client({ connectionString: url, ssl, connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    const got = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 4000);
      client.on('notification', (n) => {
        if (n.channel === 'pooler_probe') { clearTimeout(timer); resolve(true); }
      });
      client.query('LISTEN pooler_probe')
        .then(() => client.query(`NOTIFY pooler_probe, 'ping'`))
        .catch(() => { clearTimeout(timer); resolve(false); });
    });
    add(got, 'DATABASE_LISTEN_URL delivers NOTIFY', got
      ? 'yes — LISTEN survives on this connection'
      : 'NO — notification never arrived. This connection cannot back D-015 realtime.');
  } finally {
    await client.end().catch(() => {});
  }
}

await probe('DATABASE_URL', process.env.DATABASE_URL, true);
await probe('DATABASE_MIGRATION_URL', process.env.DATABASE_MIGRATION_URL, false);
await probeListen(process.env.DATABASE_LISTEN_URL);

console.log('\nPooler configuration (CLAUDE.md #3, D-015)');
console.log('─'.repeat(70));
for (const r of results) {
  const mark = r.ok === null ? '\x1b[90m·\x1b[0m' : r.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`  ${mark} ${r.label}\n      ${r.detail}`);
}
const failed = results.filter((r) => r.ok === false).length;
console.log(failed ? `\n\x1b[31m${failed} check(s) failed.\x1b[0m\n` : '\n\x1b[32mAll checks passed.\x1b[0m\n');
process.exit(failed ? 1 : 0);
