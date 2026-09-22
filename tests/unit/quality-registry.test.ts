import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { RUNNABLES, byId } from '../../scripts/quality/registry';

/**
 * The Quality page's registry (D-078).
 *
 * Two things here are load-bearing and neither is obvious from reading the
 * file. First, the registry is the page's allowlist: `POST /api/run` looks an
 * id up here and spawns the `argv` recorded against it, so anything that
 * weakens the mapping between the two weakens the guard. Second, `command` is
 * what the page SHOWS and `argv` is what it RUNS — they sit one line apart in
 * the source and nothing but this test stops them drifting into a dashboard
 * that reports one command while running another.
 */
describe('quality registry', () => {
  it('has a unique id per check, and byId finds each one', () => {
    const ids = RUNNABLES.map((r) => r.id);
    expect(new Set(ids).size, `duplicate id in ${ids.join(', ')}`).toBe(ids.length);
    for (const r of RUNNABLES) expect(byId(r.id)).toBe(r);
  });

  it('never resolves an id it does not own', () => {
    // The guard the run endpoint leans on: an unknown id is undefined, not a
    // prototype property and not a guess.
    for (const notAnId of ['', 'constructor', '__proto__', 'toString', 'rm -rf /']) {
      expect(byId(notAnId)).toBeUndefined();
    }
  });

  it('shows the command it actually runs', () => {
    for (const r of RUNNABLES) {
      // `-s` is pnpm's own quiet flag and is not part of what the user typed.
      const shown = r.argv.filter((a) => a !== '-s').join(' ');
      expect(shown, `${r.id}: page shows "${r.command}" but runs "${shown}"`)
        .toBe(r.command);
    }
  });

  it('only ever runs a script package.json actually defines', () => {
    const scripts = (JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    }).scripts;
    for (const r of RUNNABLES) {
      expect(r.argv[0], `${r.id} must run through pnpm`).toBe('pnpm');
      const script = r.argv[r.argv.length - 1]!;
      expect(scripts[script], `package.json has no "${script}" script`).toBeDefined();
    }
  });

  it('says what a green actually proves, for every check', () => {
    for (const r of RUNNABLES) {
      // A row of ticks nobody can read a meaning into is decoration. If a
      // check is worth the seconds it costs, it is worth a sentence.
      expect(r.proves.length, `${r.id} has no 'proves'`).toBeGreaterThan(40);
      expect(r.label.length).toBeGreaterThan(0);
      expect(['gate', 'deep']).toContain(r.group);
    }
  });

  it('marks the checks that write to a database', () => {
    // The integration suite provisions tenants into whatever DATABASE_URL
    // resolves to, which on a developer machine is often production. The flag
    // is what makes the page name the host and ask first; losing it silently
    // turns a one-click button into a way to seed the live hotel.
    expect(byId('integration')?.writes).toBe(true);
    expect(byId('unit')?.writes).toBeUndefined();
    expect(byId('typecheck')?.writes).toBeUndefined();
  });

  it('keeps the production build out of the dev server\'s dist directory', () => {
    // A build into `.next` while a dev server watches it corrupts that
    // server. It has cost this project a session before, and a button is
    // easier to press by accident than a command is to type.
    const build = byId('build');
    expect(build?.env?.NEXT_DIST_DIR).toBe('.next-quality');
    // ...and must put back the two files `next build` rewrites to name it.
    expect(build?.restores).toContain('next-env.d.ts');
    expect(build?.restores).toContain('tsconfig.json');
  });
});
