# The Kesari — ordering app

The customer-facing React Native client for the **restaurant** side of the
platform (D-079's visits, D-080's app). Dine in at a table, collect at a
counter, or have it delivered.

It is NOT the hotel guest app. A guest in a room scans the sticker on the
nightstand and gets the web app at `/r/{code}` — no install, no signup, which
is the whole of CLAUDE.md #9. Asking somebody to visit an App Store before they
can order a dal at 9:40pm is the wall D-012 exists to remove. See D-080 for why
the restaurant case is different.

## Running it

```bash
pnpm install                 # from THIS directory — see below
cp .env.example .env         # and set EXPO_PUBLIC_API_URL — see the comments
pnpm start                   # then press i or a
```

**Install from here, not from the repo root.** This app is deliberately NOT a
member of the web app's pnpm workspace: React Native needs a flat
`node_modules` (`nodeLinker: hoisted` in `pnpm-workspace.yaml`), and in pnpm
that is a workspace-wide setting — turning it on would relax the install layout
of the deployed web app, which does not have the problem. Its own
`pnpm-workspace.yaml` is what makes this directory a root of its own; without
it, pnpm finds the web app's, decides `/think` is the workspace, and installs
nothing here while reporting success.

### Versions are the SDK's, not `latest`

`react-native` is pinned to what `expo/bundledNativeModules.json` names —
0.86.3 for SDK 57, not 0.87.1. They are not interchangeable: 0.87 removed
`react-native/rn-get-polyfills`, which `@expo/metro-config@57` still calls, and
the bundle fails before it starts with a module-not-found that names a path
rather than the mismatch. Use `npx expo install <pkg>` rather than picking
versions by hand; picking by hand is how this was got wrong.

The API must be running. From the repo root:

```bash
pnpm dev                     # simulator / emulator
pnpm dev:lan                 # a real phone on the same wifi
pnpm demo:reset              # seeds the three demo links
```

The seeded links are `the-kesari-table-4`, `the-kesari-counter` and
`the-kesari-order`. Any of them can be typed into the entry screen; the first
is a table tent, the last offers delivery.

## How it talks to the server

Every call goes through `lib/api.ts` and nothing else composes a URL. The
contract lives in the web app at `src/lib/api-contract.ts` and is imported
here as `@contract` — **type-only, always**. That file deliberately holds no
runtime code, so the alias cannot drag Next.js, `pg` and the server into Metro.
A changed response shape is a compile error here rather than a blank screen on
somebody's phone.

Auth is a bearer token that is the same string the web holds in a cookie. Same
session row, same revocation, same expiry — see `src/lib/api-auth.ts`.

## Layout

```
app/                 expo-router — the file is the route
  index.tsx          the way in: a deep link, the camera, or typing a code
  scan.tsx           the camera, asked for in context rather than at launch
  menu.tsx           the menu, a section rail, and the cart pill
  dish/[itemId].tsx  one dish and its choices
  cart.tsx           the order, and the one question this flow asks
  order/[orderId].tsx  tracking — polls while live, stops when it is not
  orders.tsx         this visit's orders
lib/
  api.ts             the only place that knows about HTTP
  session.tsx        the visit and the cart; nothing else is shared
  theme.ts           the Kesari palette, hand-kept and drift-tested
components/          what turned out to be genuinely shared
```

## The palette is a copy, and a test keeps it honest

React Native has no CSS custom properties and no `color-mix()`, so
`src/styles/theme.css` cannot be consumed here — and D-023 removed the token
generator on purpose rather than keep a build step for one consumer.
`mobile/lib/theme.ts` is therefore a hand-kept copy, and
`tests/unit/mobile-theme.test.ts` (in the web app, where `pnpm test` runs)
reads both files and fails if either moves.

## What is not built

- **Push notifications.** The one thing a PWA cannot do on iOS and the best
  reason for this app to exist. The tracking screen polls instead.
- **Accounts.** No sign-in (D-080), so order history is per visit and lasts
  six hours. Phone + OTP is what would change that, and it needs an SMS
  provider the product does not have.
- **Payment.** Pay at the counter or to the rider. A visit has no folio
  (D-079); when Razorpay is wired up it attaches to the order.
- **Store builds.** `eas.json` has the three profiles; neither store has an
  app record, and `associatedDomains` / `assetlinks.json` need the deployment
  to serve the two verification files before universal links verify.
