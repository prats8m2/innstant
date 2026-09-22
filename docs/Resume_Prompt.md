# Resume prompt

Paste the block below into a new Claude Code session in this repo. It is
deliberately short: `CLAUDE.md` loads automatically and `docs/STATUS.md` is the
real handoff, so this only has to point at them, name the next task, and list
the traps that have already cost time.

Keep it current — when the task at the top changes, change it here.

---

```text
Read CLAUDE.md, then docs/STATUS.md (the "Pick up here" and "Open issues"
sections), then run `pnpm status`. If the command and the file disagree, the
command is right and the file is stale — fix the file.

TASK

1. DEPLOY. The skeleton loaders are finished and committed (D-077) — eleven
   loading.tsx files across the guest app — and production is a commit behind,
   so none of them are live. Nothing else is pending.

     npx --yes @railway/cli@latest up --service kesari --detach

   Then verify the change is actually there before calling it deployed: load
   https://innstant.in/r/the-kesari-214 on a throttled connection and confirm
   a tap shows a skeleton rather than holding the previous screen.

2. Then docs/STATUS.md "Open issues". The demo's seeded stays expire on
   5 OCTOBER 2026; after that /demo shows its "not open" page until somebody
   runs `pnpm demo:reset`. A scheduled reseed is the standing fix, it is not
   built, and it now has a deadline.

ENVIRONMENT — these have each cost a session before

- Node: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22.23.2`
  before any pnpm/npx command.
- The account holder runs their own dev server on :3000, and it has been seen
  pointing at a LOCAL Docker Postgres rather than Railway because a
  DATABASE_URL exported in that shell beats .env. Do not assume :3000 shows
  what you changed. Start your own on another port with
  `env -u DATABASE_URL npx next dev -p 3100`, which reads .env and reaches
  Railway.
- Railway CLI is not installed globally. Use `npx --yes @railway/cli@latest`.
  Deploy with `... up --service kesari --detach`. A deploy takes roughly 5–10
  minutes; poll for the actual change rather than sleeping a fixed time, and
  never report "deployed" from the upload line alone.
- Never run `pnpm build` while a dev server is running — it corrupts .next.
  Kill it, `rm -rf .next`, then build.
- `pnpm demo:reset` wipes and reseeds The Kesari against whatever DATABASE_URL
  resolves to. Demo QR codes are stable (`the-kesari-214`) and survive it.

DISCIPLINE — the test suite enforces all of this

- No hex colour in any .tsx or .module.css. Tokens from src/styles/theme.css
  only. The check also catches a hex inside a multi-line comment, because
  continuation lines do not start with an asterisk.
- No per-component `prefers-reduced-motion` block. theme.css answers it once,
  product-wide, by collapsing every duration.
- A module's tables are importable only from that module (ESLint enforces it).
- Shared stylesheets: check a class name is not already taken before adding
  it. A duplicate does not error, the later rule silently wins, and this has
  caused two real bugs — a blob over the menu rail, and a chip stretched
  across the service screen.
- Prefer a maintained library for a solved problem, judged on SHIPPED bytes
  (CLAUDE.md "Conventions"). Icons are lucide-react.
- Verify UI by SCREENSHOT, not by reading the diff. The skeleton session's one
  real bug — bars overlapping a heading — was invisible in the code and
  obvious in the first screenshot pass.

DEFINITION OF DONE

`pnpm typecheck && pnpm lint && pnpm test && pnpm build`, then verify the
change on a running app — screenshot it, do not assume. Commit with a
conventional message explaining WHY. Record anything non-obvious as a new
D-0xx in docs/DECISIONS.md (D-077 is the last one used) and update
docs/STATUS.md before finishing.

Ask before: changing the tenancy model, adding an external service, changing a
state machine, or anything in docs/EXTENSION-POINTS.md.
```
