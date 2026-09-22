/**
 * Running the checks, one at a time, and remembering what happened.
 *
 * ─── Why serial ────────────────────────────────────────────────────────────
 *
 * `tsc`, `eslint` and `vitest` all saturate the cores they are given. Run
 * concurrently they finish in roughly the same total wall-clock but every
 * individual duration becomes a lie, and the durations are half of why this
 * page is worth looking at. One queue, in the order asked for.
 *
 * ─── Why every result carries a commit ─────────────────────────────────────
 *
 * A green tick with no provenance is the thing this page exists to replace.
 * Every result records the HEAD it ran against and whether the worktree was
 * dirty; if either has moved since, the row reads STALE rather than green.
 * That is the discipline `pnpm status` applies to docs/STATUS.md — state the
 * fact and the moment it was true, or do not state it.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { sh, treeHash } from '../lib/project-checks';
import { byId, RUNNABLES, type CheckId, type Runnable } from './registry';

const STATE_DIR = '.quality';
const STATE_FILE = join(STATE_DIR, 'state.json');

/** Output kept per check. Enough for a stack trace, not a whole build log. */
const MAX_OUTPUT = 256 * 1024;

export type Status = 'never' | 'queued' | 'running' | 'pass' | 'fail' | 'cancelled';

export interface Result {
  id: CheckId;
  status: Status;
  /** Epoch ms. */
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number | null;
  exitCode: number | null;
  summary: string | null;
  /** The HEAD this ran against, whether anything was uncommitted, and a
   *  fingerprint of the tree at the time — the three facts that decide
   *  whether this result still describes the code in front of you. */
  commit: string | null;
  dirty: boolean | null;
  tree: string | null;
  output: string;
}

export interface Revision {
  commit: string;
  /** See treeHash(): what makes a finished result stale when it changes. */
  tree: string;
  subject: string;
  branch: string;
  dirty: boolean;
  dirtyCount: number;
}

/**
 * Every results event carries the revision it was computed against.
 *
 * Not because the page could not ask — it can — but because asking is a
 * round trip, and in the gap the page repaints a just-finished green against
 * the worktree as it was when the tab opened, which flashes STALE on a
 * result that is anything but. The two facts are only meaningful together,
 * so they travel together.
 */
export type Event =
  | { type: 'results'; results: Result[]; revision: Revision }
  | { type: 'output'; id: CheckId; chunk: string };

type Listener = (event: Event) => void;

const listeners = new Set<Listener>();
const results = new Map<CheckId, Result>();
const queue: CheckId[] = [];
let active: { id: CheckId; child: ChildProcess } | null = null;

function blank(id: CheckId): Result {
  return {
    id, status: 'never', startedAt: null, finishedAt: null, durationMs: null,
    exitCode: null, summary: null, commit: null, dirty: null, tree: null, output: '',
  };
}

for (const r of RUNNABLES) results.set(r.id, blank(r.id));

/** The current HEAD and worktree state — what a fresh result is stamped with. */
export function revision(): Revision {
  const porcelain = sh('git status --porcelain');
  return {
    commit: sh('git rev-parse --short HEAD') || '(none)',
    tree: treeHash(),
    subject: sh('git log -1 --format=%s') || '(no commits)',
    branch: sh('git rev-parse --abbrev-ref HEAD') || '(none)',
    dirty: porcelain.length > 0,
    dirtyCount: porcelain ? porcelain.split('\n').length : 0,
  };
}

export function snapshot(): Result[] {
  return RUNNABLES.map((r) => results.get(r.id) ?? blank(r.id));
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(event: Event): void {
  for (const fn of listeners) fn(event);
}

function publish(): void {
  emit({ type: 'results', results: snapshot(), revision: revision() });
}

function persist(): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    // Output is deliberately dropped on the way to disk. It is by far the
    // largest part, it is only interesting while the run is fresh in mind,
    // and a state file that has to be parsed before the page can paint is a
    // worse trade than re-running the check.
    const lean = snapshot().map(({ output: _output, ...rest }) => rest);
    writeFileSync(STATE_FILE, JSON.stringify(lean, null, 2));
  } catch {
    // A dashboard that cannot write its cache is still a working dashboard.
  }
}

export function restore(): void {
  if (!existsSync(STATE_FILE)) return;
  try {
    const saved: unknown = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    if (!Array.isArray(saved)) return;
    for (const row of saved) {
      const r = row as Partial<Result>;
      if (!r.id || !byId(r.id)) continue;
      // Anything caught mid-flight by a restart did not finish, and showing
      // it as still running would be the dashboard lying about its own state.
      const status: Status = r.status === 'running' || r.status === 'queued'
        ? 'cancelled'
        : (r.status ?? 'never');
      results.set(r.id, { ...blank(r.id), ...r, status, output: '' });
    }
  } catch {
    // A corrupt cache is not worth a crash. Start from nothing.
  }
}

/**
 * ANSI escapes, stripped.
 *
 * The children are told NO_COLOR and FORCE_COLOR=0 as well, but a tool that
 * ignores both would otherwise put raw escape bytes into a <pre>. Written as
 * the \u001B escape rather than a literal ESC byte, so this file stays plain
 * copy-pasteable text — and so the leading escape is visibly part of the
 * pattern, which is what stops it matching an innocent "[0m" in a test name.
 */
// `no-control-regex` is a sound default and wrong here: matching the control
// character IS the job, and stripping it is what keeps a <pre> readable.
// eslint-disable-next-line no-control-regex
const ANSI = /\u001B\[[0-9;]*[A-Za-z]/g;

function run(runnable: Runnable): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const rev = revision();
    const [command, ...args] = runnable.argv;
    if (!command) { resolve(); return; }

    /**
     * Put back what the command moves.
     *
     * `next build` rewrites next-env.d.ts and tsconfig.json to name whichever
     * distDir it used. Snapshotting them here and copying them back when it
     * closes means pressing Build leaves the worktree exactly as it was — a
     * button is far easier to press by accident than a command is to type.
     */
    const backups = new Map<string, string>();
    for (const file of runnable.restores ?? []) {
      if (!existsSync(file)) continue;
      const backup = join(STATE_DIR, `restore-${file.replace(/[^\w.-]/g, '_')}`);
      try {
        mkdirSync(STATE_DIR, { recursive: true });
        copyFileSync(file, backup);
        backups.set(file, backup);
      } catch {
        // Best effort. The check still runs; it just may leave a diff.
      }
    }

    let output = '';
    const record = (chunk: string): void => {
      const clean = chunk.replace(ANSI, '');
      output = (output + clean).slice(-MAX_OUTPUT);
      emit({ type: 'output', id: runnable.id, chunk: clean });
    };

    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        ...runnable.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    active = { id: runnable.id, child };
    results.set(runnable.id, {
      ...blank(runnable.id),
      status: 'running',
      startedAt: started,
      commit: rev.commit,
      dirty: rev.dirty,
      tree: rev.tree,
    });
    publish();

    child.stdout?.on('data', (d: Buffer) => record(d.toString()));
    child.stderr?.on('data', (d: Buffer) => record(d.toString()));

    const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
      for (const [file, backup] of backups) {
        try {
          copyFileSync(backup, file);
          rmSync(backup, { force: true });
        } catch {
          // Nothing useful to do here; the file is reported by git either way.
        }
      }
      const cancelled = signal !== null && code === null;
      results.set(runnable.id, {
        id: runnable.id,
        status: cancelled ? 'cancelled' : code === 0 ? 'pass' : 'fail',
        startedAt: started,
        finishedAt: Date.now(),
        durationMs: Date.now() - started,
        exitCode: code,
        summary: runnable.summarise?.(output) ?? null,
        commit: rev.commit,
        dirty: rev.dirty,
        tree: rev.tree,
        output,
      });
      active = null;
      publish();
      persist();
      resolve();
    };

    child.on('close', finish);
    child.on('error', (e) => {
      record(`\nfailed to start: ${e.message}\n`);
      finish(-1, null);
    });
  });
}

let pumping = false;

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const next = queue.shift();
      if (!next) break;
      const runnable = byId(next);
      // Only still-queued work runs: anything cancelled while it waited is
      // dropped here rather than started and immediately killed.
      if (!runnable || results.get(next)?.status !== 'queued') continue;
      await run(runnable);
    }
  } finally {
    pumping = false;
  }
}

/** Queue one or more checks. An unknown id is ignored, never guessed at. */
export function enqueue(ids: readonly string[]): CheckId[] {
  const accepted: CheckId[] = [];
  for (const id of ids) {
    const runnable = byId(id);
    if (!runnable) continue;
    const current = results.get(runnable.id)?.status;
    if (current === 'queued' || current === 'running') continue;
    results.set(runnable.id, { ...blank(runnable.id), status: 'queued' });
    queue.push(runnable.id);
    accepted.push(runnable.id);
  }
  if (accepted.length) {
    publish();
    void pump();
  }
  return accepted;
}

export function cancel(id: string): boolean {
  const runnable = byId(id);
  if (!runnable) return false;
  const at = queue.indexOf(runnable.id);
  if (at >= 0) {
    queue.splice(at, 1);
    results.set(runnable.id, { ...blank(runnable.id), status: 'cancelled' });
    publish();
    return true;
  }
  if (active?.id === runnable.id) {
    active.child.kill('SIGTERM');
    return true;
  }
  return false;
}

export function cancelAll(): void {
  queue.splice(0, queue.length);
  for (const [id, r] of results) {
    if (r.status === 'queued') results.set(id, { ...blank(id), status: 'cancelled' });
  }
  if (active) active.child.kill('SIGTERM');
  publish();
}

/** Kill anything still running, so Ctrl-C does not orphan a vitest. */
export function shutdown(): void {
  queue.splice(0, queue.length);
  if (active) active.child.kill('SIGKILL');
}
