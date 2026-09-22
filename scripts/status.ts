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
import {
  type Check, OPTIONAL_KEYS, sh, loadEnv, checkDatabase, checkDeploy,
} from './lib/project-checks';

const quiet = (cmd: string): boolean => {
  try {
    execSync(cmd, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};


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
  const unset = OPTIONAL_KEYS.filter((k) => !env[k]);
  if (unset.length) console.log(`  \x1b[90m·\x1b[0m ${'not needed yet'.padEnd(28)} ${unset.join(', ')}`);

  console.log('\n\x1b[1mDEPLOY\x1b[0m');
  console.log('─'.repeat(64));
  for (const c of checkDeploy()) {
    const mark = c.ok === null ? '\x1b[90m·\x1b[0m' : c.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    console.log(`  ${mark} ${c.label.padEnd(28)} ${c.detail}`);
  }

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
