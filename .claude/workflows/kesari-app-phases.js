export const meta = {
  name: 'kesari-app-phases',
  description: 'Finish phase 1 and run phases 2-4 of the app redesign, committing after each',
  phases: [
    { title: 'Phase1',  detail: 'bottom sheet, skeletons, pull-to-refresh, haptics' },
    { title: 'Commit1', detail: 'gates, fix, commit' },
    { title: 'Phase2',  detail: 'image-led home, menu and dish screens' },
    { title: 'Commit2', detail: 'gates, fix, commit' },
    { title: 'Phase3',  detail: 'search endpoint + filters + most-ordered, in parallel' },
    { title: 'Commit3', detail: 'gates, fix, commit' },
    { title: 'Phase4',  detail: 'motion, optimistic cart, empty and error states' },
    { title: 'Commit4', detail: 'gates, fix, commit' },
  ],
}

const ROOT = '/Users/prateek.singh/Documents/Practice/think'

const RULES = `
REPO: ${ROOT}. Read ${ROOT}/CLAUDE.md FIRST and obey its non-negotiables.
Read ${ROOT}/docs/APP-REDESIGN-PLAN.md — it is the plan you are executing.

HARD RULES
- NEVER deploy. No \`railway\` anything. Never touch production.
- NEVER run a migration, and do NOT add one. If something seems to need
  schema, DEFER it and say so in your report. This whole redesign is
  deliberately migration-free.
- Do not run \`pnpm demo:reset\` against anything but localhost.
- Do not kill processes you did not start, and never kill Docker — the local
  Postgres lives in it, and killing it has already cost this project once.
- Money is integer minor units, Indian-grouped, tabular figures (#5).
- Browsing is NEVER gated behind an account (#9).
- order_items snapshots are receipts; never recompute them (#6).
- Every colour, radius, duration, size comes from mobile/lib/theme.ts. A
  hardcoded hex in a component is a defect. Saffron hovers LIGHTER; text on
  saffron is the GROUND (#101E33).
- Icons: lucide-react-native only. No emoji as UI.
- 48pt minimum touch targets. Honour prefers-reduced-motion everywhere.

ALREADY DONE — do not redo it
- Tab bar exists at mobile/app/(tabs)/ — home, orders, account. Search is
  deliberately NOT a tab until phase 3.
- mobile/components/dish-photo.tsx wraps expo-image with blurhash support.
  Use it; do not write a second image component.
- Dish rows on home and menu already show photos.
- Installed and configured: expo-image, react-native-reanimated (4.5.1,
  paired with react-native-worklets 0.10.1 — do NOT change either version),
  react-native-gesture-handler, @gorhom/bottom-sheet, expo-haptics.
  babel.config.js carries react-native-worklets/plugin.
- GestureHandlerRootView already wraps the app in mobile/app/_layout.tsx.
- Demo dish photography is seeded from src/modules/catalog/kesari-menu.ts.

HOW TO VERIFY — this matters more than the code
- Typecheck BOTH: \`cd ${ROOT} && npx tsc --noEmit\` and
  \`cd ${ROOT}/mobile && npx tsc --noEmit\`.
- Bundle for a device, because tsc does not catch what Metro does:
  \`cd ${ROOT}/mobile && npx expo export --platform android --output-dir /tmp/kesari-wf\`
  A \`crypto.randomUUID()\` once shipped and crashed on a phone precisely
  because only the web target had been checked.
- RENDER IT. Do not report a screen as working without having seen it.
  The API runs on localhost:3005 (start with \`cd ${ROOT} && PORT=3005 pnpm dev\`
  if it is down). The Expo web target: \`cd ${ROOT}/mobile &&
  EXPO_PUBLIC_API_URL=http://localhost:3005 npx expo start --web --port 8099\`.
  Drive it with Playwright from ${ROOT} (where @playwright/test is installed)
  and look at the screenshots. Note: SecureStore no-ops on web, so a
  page.goto() reload drops the session — navigate IN-APP between steps.
- Measure, do not eyeball. Playwright calls a 5px sliver "visible"; a kitchen
  board shipped broken for exactly that reason.

COMMENT STYLE
Match the surrounding code. Read neighbouring files first. This codebase
explains WHY and records what was rejected and why; it never narrates what
the code plainly does.
`

const COMMIT = `
Now COMMIT. You are the only agent committing in this phase.

1. Run every gate from ${ROOT} and fix what fails:
     npx tsc --noEmit
     pnpm lint
     pnpm test
     cd mobile && npx tsc --noEmit
     cd mobile && npx expo export --platform android --output-dir /tmp/kesari-wf
2. Verify a finding before acting on it. A reviewer working from a summary
   can be wrong, and a "fix" to a non-problem makes the code worse.
3. \`git add -A\` then ONE commit for this phase.

The commit message must match this repo's style — read \`git log -3\` first.
Subject line lowercase after the type, no trailing full stop. The body
explains WHY, names what was rejected and why, and states plainly anything
that does NOT work or was deliberately left out. Never claim something was
verified that you did not verify. End with exactly:

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013aL2YWyKTiHu5xgjqNZH9u

Do NOT push. Do NOT deploy. Report the commit hash and anything still broken.
`

// ── Phase 1, the rest of it ────────────────────────────────────────────────
phase('Phase1')

const p1 = await agent(`${RULES}

FINISH PHASE 1. The tab bar and photographs are done; these four are not.

1. BOTTOM SHEET for dish options. Today \`mobile/app/dish/[itemId].tsx\` is a
   full screen push. Modifier selection should rise as a @gorhom/bottom-sheet
   over the menu, with the quantity and running total pinned at its bottom.
   Keep the full screen route working — a deep link to a dish must still
   render something, and a sheet cannot be deep-linked to.

2. SKELETON SHIMMER while the menu, orders and home load. In the SHAPE of the
   content, not a spinner: a dish row skeleton looks like a dish row. Use
   Reanimated. Respect prefers-reduced-motion by rendering the skeleton
   static rather than animating it.

3. PULL TO REFRESH on menu, orders, and home.

4. HAPTICS via expo-haptics on: adding to the cart, removing from it, and
   placing an order. Light impact for add/remove, success notification for
   the order. Nothing on scroll or navigation — haptics on everything is
   noise, and it is the fastest way to make an app feel cheap.

Report what you built, what you rendered, and anything you could not do.`,
  { label: 'build:phase1', phase: 'Phase1' })

phase('Commit1')
const c1 = await agent(`${RULES}\n\nThe phase 1 build agent reported:\n${p1}\n${COMMIT}`,
  { label: 'commit:phase1', phase: 'Commit1' })
log(`phase 1 committed`)

// ── Phase 2 ────────────────────────────────────────────────────────────────
phase('Phase2')

const p2 = await agent(`${RULES}

PHASE 2 — the image-led screens. Photographs exist now, so the layouts that
were designed around their absence should be revisited.

Target is Swiggy's RESTAURANT DETAIL page, not its marketplace home. We sell
one restaurant; there is no list of venues, no cuisine filter across vendors,
no delivery-partner map.

1. HOME — a photo hero rather than the CSS arch alone (keep the arch; it is
   the brand, and the plan says Swiggy's structure with the Kesari's skin).
   Category circles or chips from the real sections. An "Order again" rail
   built from genuine account history when signed in, absent when not.
   The live-order card stays pinned at the top when there is one.

2. MENU — photo dish cards, a sticky section rail that tracks scroll, and
   veg/non-veg marks in the Indian convention (the green and red bordered
   squares — a legal convention here, not decoration). The data is in
   \`dietaryFlags\`; 7 of 10 demo dishes carry it, so handle its absence.

3. DISH — full-bleed photo header that collapses as you scroll, modifiers in
   the bottom sheet phase 1 built, quantity and total pinned.

Invent NOTHING the data cannot support: no ratings, no review counts, no
distance, no delivery fee, no discount badge. Those do not exist and the plan
argues against adding them.

Report what you built and what you rendered.`,
  { label: 'build:phase2', phase: 'Phase2' })

phase('Commit2')
const c2 = await agent(`${RULES}\n\nThe phase 2 build agent reported:\n${p2}\n${COMMIT}`,
  { label: 'commit:phase2', phase: 'Commit2' })
log(`phase 2 committed`)

// ── Phase 3 — backend and mobile are disjoint, so they run together ────────
phase('Phase3')

const p3 = await parallel([
  () => agent(`${RULES}

PHASE 3, BACKEND. You own src/ and tests/ ONLY — another agent is editing
mobile/ at the same time. Do not touch it.

1. MENU SEARCH endpoint. There is none. Ten dishes filter fine in a client
   and sixty do not, and a real property has sixty — so the server owns this.
   Match on name and description, case- and accent-insensitive. Scope it to
   the outlet the session is on. Zod at the boundary.

2. FILTERS on the same read: dietary flags, spice level, price range. All
   three already exist on menu_items.

3. MOST ORDERED. Count \`order_items\` over a trailing window, scoped to the
   outlet, and expose a per-dish rank or flag. This is the one Swiggy-style
   badge we can EARN rather than invent — it must come from real orders, and
   it must not fabricate a number when there is no history.

Add the contract types to src/lib/api-contract.ts. Unit tests for the
ranking and the filter logic. NO MIGRATION — if you think you need one, stop
and report instead.

Report the exact request and response shapes so the mobile agent can be
checked against them.`, { label: 'build:p3-api', phase: 'Phase3' }),

  () => agent(`${RULES}

PHASE 3, MOBILE. You own mobile/ ONLY — another agent is editing src/ at the
same time. Do not touch it.

1. SEARCH becomes a fourth tab, between Order and Orders. A search field, a
   debounced query, results as the photo dish rows the menu already uses, and
   recent searches kept locally. Empty state before anything is typed, and a
   distinct "nothing matched" state.

2. FILTER CHIPS on menu and search: veg / non-veg / spice / price. Horizontal
   scrolling row, multi-select, with a visible count when any are active and
   one tap to clear.

3. A "Most ordered" badge on dish rows where the API says so.

The backend agent is building the endpoint right now. Assume:
  GET /api/v1/menu/search?q=&flags=&spiceMax=&priceMax=
returning the same ApiDish shape the menu returns. If the real contract
differs, the commit agent will reconcile — build against this and SAY so in
your report.

Until the endpoint exists you can develop against the existing /menu response
filtered client-side. Do not ship that as the final answer; wire the endpoint.

Report what you built and what you rendered.`, { label: 'build:p3-app', phase: 'Phase3' }),
])

phase('Commit3')
const c3 = await agent(`${RULES}

Two agents built phase 3 in parallel and may disagree about the contract.

BACKEND reported:
${p3[0]}

MOBILE reported:
${p3[1]}

FIRST: reconcile them. Read the actual route and the actual client call and
make them agree — the mobile agent was told to assume a shape and may have
assumed wrong. Then verify search actually returns results end to end against
localhost:3005, by calling it, not by reading it.

${COMMIT}`, { label: 'commit:phase3', phase: 'Commit3' })
log(`phase 3 committed`)

// ── Phase 4 ────────────────────────────────────────────────────────────────
phase('Phase4')

const p4 = await agent(`${RULES}

PHASE 4 — motion and the states nobody draws.

1. OPTIMISTIC CART. Adding a dish should move the count immediately and
   reconcile when the server answers, rolling back visibly if it refuses.
   Taps are currently swallowed while a request is in flight; keep that rule
   for the SAME dish — four overlapping writes against one cart row is a race
   the UI should not start.

2. SHARED-ELEMENT TRANSITION from a dish row's photo into the dish screen.

3. EMPTY, ERROR AND OFFLINE states, drawn rather than defaulted, on every
   list: menu, search, orders, addresses, cart. Guest-facing copy says what
   happened and what to do; it never apologises and is never vague.

4. The 180-320ms motion band applied consistently, every animation killed to
   1ms under prefers-reduced-motion.

Report what you built and what you rendered.`,
  { label: 'build:phase4', phase: 'Phase4' })

phase('Commit4')
const c4 = await agent(`${RULES}

The phase 4 build agent reported:
${p4}

Also, as the LAST agent in this run: update ${ROOT}/docs/STATUS.md so the
"## Now" section reflects all four phases, and update
${ROOT}/docs/APP-REDESIGN-PLAN.md to mark what is done and what is still
outstanding (real photography, ratings, offers, rider map). Include those doc
changes in the same commit.

${COMMIT}`, { label: 'commit:phase4', phase: 'Commit4' })

return { p1, c1, p2, c2, p3, c3, p4, c4 }
