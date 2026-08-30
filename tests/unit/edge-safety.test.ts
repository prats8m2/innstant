import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * src/middleware.ts runs on the EDGE runtime. Importing anything that reaches a
 * Node built-in breaks `pnpm build` — which already happened once, when the
 * cookie name was imported from sessions.ts and dragged in node:crypto.
 *
 * The build catches it, but only after a full compile. This catches it in the
 * unit suite, with a message that says what to do.
 */
const FORBIDDEN = ['node:crypto', 'node:fs', 'node:net', "from 'pg'", '@node-rs/argon2', '@/db'];

function importsOf(file: string): string[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => /^\s*import\b/.test(l));
}

describe('middleware stays edge-safe', () => {
  it('imports nothing that reaches Node built-ins or the database', () => {
    const lines = importsOf('src/middleware.ts').join('\n');
    for (const bad of FORBIDDEN) {
      expect(lines, `middleware must not import ${bad}`).not.toContain(bad);
    }
  });

  it('takes cookie constants from the inert cookie module, not sessions', () => {
    const lines = importsOf('src/middleware.ts').join('\n');
    expect(lines).toContain('identity/cookie');
    expect(lines).not.toContain('identity/sessions');
  });

  it('cookie.ts itself imports nothing at all', () => {
    expect(importsOf('src/modules/identity/cookie.ts')).toHaveLength(0);
  });

  // Same reason as cookie.ts: the middleware mints the request id, so
  // request-id.ts is edge code. pino (or anything that reaches node:) belongs
  // in logger.ts, which the middleware must never import.
  it('request-id.ts itself imports nothing at all', () => {
    expect(importsOf('src/lib/request-id.ts')).toHaveLength(0);
  });

  it('instrumentation.ts reaches the database only behind a runtime check', () => {
    const source = readFileSync('src/instrumentation.ts', 'utf8');
    expect(importsOf('src/instrumentation.ts')).toHaveLength(0);
    // A static `@/db` import here breaks the EDGE build — webpack follows it
    // to pg, then to node:fs. The check is what lets it drop the branch.
    expect(source).toContain("process.env.NEXT_RUNTIME === 'nodejs'");
  });
});
