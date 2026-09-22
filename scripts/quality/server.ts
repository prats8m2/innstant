/**
 * `pnpm quality` — every validation this project has, on one page, runnable.
 *
 * ─── Why this is its own process ───────────────────────────────────────────
 *
 * It spawns build tooling. Nothing that spawns build tooling belongs in the
 * Next app: that app runs as a long-lived Node process serving hotel guests
 * on a public domain, and the only thing standing between a public URL and
 * `exec` would be an environment check. A separate server on its own port,
 * started by hand, cannot be deployed by accident and cannot be reached from
 * innstant.in at all.
 *
 * It is also why this reads `src/styles/theme.css` off disk and serves it
 * rather than restating the palette: the page looks like the ops console
 * because it IS the ops console's stylesheet, and there is no second copy of
 * a colour to drift (CLAUDE.md, "CSS custom properties are the only source").
 *
 * ─── What stops a web page on the internet running your test suite ─────────
 *
 * Bound to the loopback address, so nothing off this machine can reach it at
 * all. Beyond that, a page on some other origin could still try to POST here
 * through the browser, so mutating requests must (a) carry `X-Quality: 1`,
 * which forces a CORS preflight that is never answered, and (b) have either
 * no `Origin` or one of this server's own. No CORS headers are ever sent.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import {
  loadEnv, checkDatabase, checkDeploy, databaseTarget, OPTIONAL_KEYS, sh,
} from '../lib/project-checks';
import { RUNNABLES } from './registry';
import {
  enqueue, cancel, cancelAll, snapshot, subscribe, revision, restore, shutdown,
  type Event,
} from './runner';

const PORT = Number(process.env.QUALITY_PORT ?? 3999);
const HOST = '127.0.0.1';
const PUBLIC = join(import.meta.dirname, 'public');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function send(res: ServerResponse, code: number, body: string, type: string): void {
  res.writeHead(code, {
    'content-type': type,
    'cache-control': 'no-store',
    // This page renders command output. It never needs to be framed, and it
    // loads nothing from anywhere but itself.
    'x-frame-options': 'DENY',
    'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'",
  });
  res.end(body);
}

const json = (res: ServerResponse, code: number, value: unknown): void =>
  send(res, code, JSON.stringify(value), 'application/json; charset=utf-8');

/** Same-origin, and carrying the header a cross-origin form could not add. */
function permitted(req: IncomingMessage): boolean {
  if (req.headers['x-quality'] !== '1') return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  return origin === `http://${HOST}:${PORT}` || origin === `http://localhost:${PORT}`;
}

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) {
    chunks.push(c as Buffer);
    // A run request is a few dozen bytes. Anything larger is not one.
    if (chunks.reduce((n, b) => n + b.length, 0) > 4096) return null;
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

/** The page's static half: the shell, its stylesheet, and the product's tokens. */
function serveStatic(pathname: string, res: ServerResponse): boolean {
  if (pathname === '/theme.css') {
    const theme = 'src/styles/theme.css';
    if (!existsSync(theme)) { send(res, 404, '/* theme.css not found */', TYPES['.css']!); return true; }
    send(res, 200, readFileSync(theme, 'utf8'), TYPES['.css']!);
    return true;
  }
  const name = pathname === '/' ? 'index.html' : pathname.slice(1);
  // No traversal: one flat directory, and a name with a slash or a dot-dot in
  // it is simply not served.
  if (name.includes('/') || name.includes('..')) return false;
  const file = join(PUBLIC, name);
  if (!existsSync(file)) return false;
  send(res, 200, readFileSync(file, 'utf8'), TYPES[extname(file)] ?? 'text/plain; charset=utf-8');
  return true;
}

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
    const path = url.pathname;

    if (req.method === 'GET' && serveStatic(path, res)) return;

    /** The registry and the last-known results — everything the page paints. */
    if (req.method === 'GET' && path === '/api/state') {
      json(res, 200, {
        revision: revision(),
        node: process.version,
        pinned: existsSync('.nvmrc') ? readFileSync('.nvmrc', 'utf8').trim() : null,
        runnables: RUNNABLES,
        results: snapshot(),
        // So a row that writes can say where it writes. Host and database only.
        database: databaseTarget(loadEnv()),
      });
      return;
    }

    /**
     * The derived checks: the database's own answers, and the deploy posture.
     *
     * Separate from /api/state because it opens a connection — the page paints
     * first and fills this in, rather than waiting on Railway to hand over a
     * socket before it shows anything at all.
     */
    if (req.method === 'GET' && path === '/api/environment') {
      const env = loadEnv();
      const unset = OPTIONAL_KEYS.filter((k) => !env[k]);
      json(res, 200, {
        database: await checkDatabase(env),
        deploy: checkDeploy(),
        optional: unset,
      });
      return;
    }

    /** Live results and live output, for as long as the tab is open. */
    if (req.method === 'GET' && path === '/api/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      const write = (event: Event): void => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };
      write({ type: 'results', results: snapshot(), revision: revision() });
      const off = subscribe(write);
      // Some proxies and some browsers drop a silent stream. Nothing is in
      // front of this one, but a comment every 20s costs nothing.
      const beat = setInterval(() => res.write(': beat\n\n'), 20_000);
      req.on('close', () => { clearInterval(beat); off(); });
      return;
    }

    if (req.method === 'POST' && (path === '/api/run' || path === '/api/cancel')) {
      if (!permitted(req)) { json(res, 403, { error: 'same-origin only' }); return; }
      const payload = await body(req);
      const ids = (payload as { ids?: unknown })?.ids;
      if (!Array.isArray(ids) || ids.some((i) => typeof i !== 'string')) {
        json(res, 400, { error: 'expected { ids: string[] }' });
        return;
      }
      if (path === '/api/run') {
        json(res, 202, { queued: enqueue(ids as string[]) });
      } else {
        if (ids.length === 0) cancelAll();
        else for (const id of ids as string[]) cancel(id);
        json(res, 202, { cancelled: ids });
      }
      return;
    }

    send(res, 404, 'not found', 'text/plain; charset=utf-8');
  })().catch((e: unknown) => {
    json(res, 500, { error: e instanceof Error ? e.message : 'unknown' });
  });
});

restore();

server.listen(PORT, HOST, () => {
  const rev = revision();
  const bold = (s: string): string => `\u001B[1m${s}\u001B[0m`;
  const dim = (s: string): string => `\u001B[90m${s}\u001B[0m`;
  console.log(`\n${bold('QUALITY')}  ·  ${RUNNABLES.length} checks, runnable`);
  console.log('─'.repeat(64));
  console.log(`  http://localhost:${PORT}`);
  console.log(dim(`  ${rev.branch} · ${rev.commit} · ${rev.dirty ? `${rev.dirtyCount} uncommitted` : 'clean'}`));
  console.log(dim('  loopback only — this process is never deployed\n'));
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    shutdown();
    server.close(() => process.exit(0));
    // A vitest mid-run can hold the socket open past the close callback.
    setTimeout(() => process.exit(0), 500).unref();
  });
}

// `git` is how the page knows which commit a green belongs to. Without it the
// page still works; every result just reads as stale, which would be a
// confusing thing to discover one check at a time.
if (!sh('git rev-parse --git-dir')) {
  console.warn('  ! not a git worktree — results cannot be stamped with a commit\n');
}
