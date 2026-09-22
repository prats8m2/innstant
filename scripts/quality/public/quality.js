/**
 * The Quality page's behaviour.
 *
 * Its own file rather than an inline <script> because the server sends a
 * strict `default-src 'self'` — this page renders the output of build tools,
 * and the one place that should never have an inline-script exemption is the
 * page that prints whatever a test run decided to say.
 */
const $ = (id) => document.getElementById(id);
const confirm = window.confirm.bind(window);
const post = (path, ids) => fetch(path, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-quality': '1' },
  body: JSON.stringify({ ids }),
});

let runnables = [];
let results = new Map();
let head = null;
let database = null;

const ms = (n) => (n == null ? '' : n < 1000 ? `${n}ms` : `${(n / 1000).toFixed(1)}s`);

const WORD = {
  never: 'not run', queued: 'queued', running: 'running',
  pass: 'passed', fail: 'FAILED', cancelled: 'stopped',
};

/**
 * A pass only counts for the tree it ran against.
 *
 * Compared by fingerprint, not by "was the worktree dirty" — during ordinary
 * work the tree is always dirty, and a badge that is always lit says nothing.
 * What matters is whether anything has changed SINCE the run: edit a file and
 * the green goes stale; touch nothing and it stays green.
 *
 * The result still shows either way. Quietly presenting an old pass as a
 * current one is the failure this page exists to replace.
 */
function stale(r) {
  if (r.status !== 'pass' && r.status !== 'fail') return false;
  if (!head || !r.commit) return false;
  return r.commit !== head.commit || r.tree !== head.tree;
}

function when(r) {
  if (!r.finishedAt) return '';
  const secs = Math.round((Date.now() - r.finishedAt) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return new Date(r.finishedAt).toLocaleDateString();
}

function rowFor(def) {
  const row = document.createElement('div');
  row.className = 'row';
  row.id = `row-${def.id}`;
  row.innerHTML = `
    <div class="head">
      <span class="dot"></span>
      <div>
        <div class="name"></div>
        <div class="cmd"></div>
      </div>
      <div class="state"></div>
      <button data-run="${def.id}">Run</button>
      <p class="proves"></p>
      ${def.needs ? '<p class="needs"></p>' : ''}
    </div>
    <details>
      <summary>Output</summary>
      <pre></pre>
    </details>`;
  row.querySelector('.name').textContent = def.label;
  row.querySelector('.cmd').textContent = def.command;
  row.querySelector('.proves').textContent = def.proves;
  if (def.needs) row.querySelector('.needs').textContent = `needs ${def.needs}`;
  if (def.writes) row.dataset.writes = 'true';
  row.querySelector('[data-run]').addEventListener('click', () => {
    const r = results.get(def.id);
    if (r && (r.status === 'running' || r.status === 'queued')) post('/api/cancel', [def.id]);
    else if (confirmWrite(def)) post('/api/run', [def.id]);
  });
  return row;
}

/**
 * The one place this page asks before doing something.
 *
 * A check marked `writes` provisions tenants into whatever DATABASE_URL
 * resolves to. Against a local Postgres that is unremarkable; against the
 * production one it writes test data into the live hotel, and on a developer
 * machine DATABASE_URL points at production more often than anyone means it
 * to. So: say the host out loud, and make them agree to it.
 */
function confirmWrite(def) {
  if (!def.writes) return true;
  const where = database ? `${database.host}/${database.database}` : 'the configured DATABASE_URL';
  if (database && database.local) return true;
  return confirm(
    `Running "${def.label}" will write test tenants into:\n\n  ${where}\n\n`
    + 'That does not look like a local database. Against the production one '
    + 'this puts test data in the live hotel.\n\nRun it anyway?',
  );
}

function paint() {
  let busy = false;
  for (const def of runnables) {
    const row = $(`row-${def.id}`);
    if (!row) continue;
    const r = results.get(def.id) ?? { status: 'never' };
    const running = r.status === 'running' || r.status === 'queued';
    busy ||= running;

    row.dataset.status = r.status;

    const bits = [`<b>${WORD[r.status] ?? r.status}</b>`];
    if (r.summary) bits.push(r.summary);
    else if (r.status === 'fail' && r.exitCode != null) bits.push(`exit ${r.exitCode}`);
    if (r.durationMs != null && !running) bits.push(ms(r.durationMs));
    if (!running && r.finishedAt) bits.push(when(r));
    row.querySelector('.state').innerHTML =
      bits.join(' · ') + (stale(r) ? '<span class="stale">stale</span>' : '');

    const button = row.querySelector('[data-run]');
    button.textContent = running ? 'Stop' : r.status === 'never' ? 'Run' : 'Re-run';

    // An empty <details> is a promise of something that is not there.
    row.querySelector('details').hidden = !row.querySelector('pre').textContent;
  }
  $('stop').disabled = !busy;
}

function append(id, chunk) {
  const pre = $(`row-${id}`)?.querySelector('pre');
  if (!pre) return;
  const atBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 24;
  pre.textContent += chunk;
  // Follow the tail only if the reader has not scrolled up to look at
  // something — yanking them back to the bottom mid-read is maddening.
  if (atBottom) pre.scrollTop = pre.scrollHeight;
}

function paintRevision(state) {
  head = state.revision;
  database = state.database ?? null;
  for (const el of document.querySelectorAll('.row[data-writes] .needs')) {
    if (!database) continue;
    el.textContent = `${el.textContent.split(' · writes to ')[0]} · writes to ${database.host}/${database.database}`;
  }
  const r = state.revision;
  $('rev').innerHTML =
    `<b>${r.branch}</b> · ${r.commit} ${r.subject} · `
    + (r.dirty ? `<b>${r.dirtyCount} uncommitted</b>` : 'clean')
    + ` · node ${state.node}`;
  if (state.pinned && !state.node.startsWith(`v${state.pinned}`)) {
    $('nodewarn').hidden = false;
    $('nodewarn').textContent =
      `Running node ${state.node}, but the repo pins ${state.pinned}. `
      + 'Results from a different runtime are not the ones CI will produce.';
  }
}

async function refresh() {
  try {
    paintRevision(await (await fetch('/api/state')).json());
    paint();
  } catch {
    // The server is gone. The page keeps what it last knew rather than
    // blanking, which is the more useful of the two failures.
  }
}

async function environment() {
  try {
    const env = await (await fetch('/api/environment')).json();
    const rows = [...env.database, ...env.deploy];
    if (env.optional.length) {
      rows.push({ label: 'not needed yet', ok: null, detail: env.optional.join(', ') });
    }
    $('facts').replaceChildren(...rows.map((c) => {
      const el = document.createElement('div');
      el.className = 'fact';
      el.dataset.ok = String(c.ok);
      el.innerHTML = '<span class="mark"></span><span class="label"></span><span class="detail"></span>';
      el.querySelector('.mark').textContent = c.ok === null ? '·' : c.ok ? '✓' : '✗';
      el.querySelector('.label').textContent = c.label;
      el.querySelector('.detail').textContent = c.detail;
      return el;
    }));
  } catch {
    $('facts').textContent = 'Could not read the environment.';
  }
}

async function start() {
  const state = await (await fetch('/api/state')).json();
  runnables = state.runnables;
  paintRevision(state);

  $('gate').replaceChildren(...runnables.filter((r) => r.group === 'gate').map(rowFor));
  $('deep').replaceChildren(...runnables.filter((r) => r.group === 'deep').map(rowFor));

  const ids = (group) => runnables.filter((r) => r.group === group).map((r) => r.id);
  $('runGates').addEventListener('click', () => post('/api/run', ids('gate')));
  $('runAll').addEventListener('click', () => {
    // Everything EXCEPT the writers, unless each writer is agreed to on its
    // own. "Run everything" should never be the gesture that seeds the
    // production database.
    const safe = runnables.filter((r) => !r.writes).map((r) => r.id);
    const writers = runnables.filter((r) => r.writes && confirmWrite(r)).map((r) => r.id);
    post('/api/run', [...safe, ...writers]);
  });
  $('stop').addEventListener('click', () => post('/api/cancel', []));

  const events = new EventSource('/api/events');
  events.onmessage = (e) => {
    const event = JSON.parse(e.data);
    if (event.type === 'results') {
      // The revision rides along with the results, so a just-finished green
      // is judged against the tree it actually ran on rather than against
      // whatever this tab last happened to fetch.
      head = event.revision ?? head;
      for (const r of event.results) {
        // A fresh run clears the pane; a finished one keeps what it printed.
        if (r.status === 'running' && results.get(r.id)?.status !== 'running') {
          const pre = $(`row-${r.id}`)?.querySelector('pre');
          if (pre) pre.textContent = '';
        }
        if (r.output) append(r.id, '');
        results.set(r.id, r);
      }
      paint();
    } else if (event.type === 'output') {
      append(event.id, event.chunk);
      const pre = $(`row-${event.id}`)?.querySelector('pre');
      if (pre) $(`row-${event.id}`).querySelector('details').hidden = false;
    }
  };

  // "just now" becomes "2m ago", and a file edited in another window turns
  // the greens stale, both without anyone touching this tab.
  setInterval(refresh, 30_000);
  environment();
}

start();
