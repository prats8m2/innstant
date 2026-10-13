# Shipping property links and the mobile app

**Steps 1-3 were RUN on 13 October 2026** and production is current — see
`docs/STATUS.md`. This is kept as the record of what was done and as the
procedure for the next schema change, which will have the same shape.

Step 4, the APK, has NOT been run: it needs an Expo account.

The runbook for getting `0008`, the `/p/` surface, `/api/v1` and the Android
app into production. Written during the session that built them, against a
production that was on `16bbca1` with 8 migrations.

**Read this whole file before running anything.** Step 1 is a schema change on
a live database and step 3 deletes and rebuilds the demo tenant.

---

## Why the order is the order

The app and the migration are not independent, and the dependency only runs one
way:

| | old schema | new schema |
|---|---|---|
| **old code** (`16bbca1`) | what is live now | **fine** |
| **new code** | **BREAKS** | the target |

New code writes `visit_id`, `fulfilment` and `destination_label`, and
`orders_fulfilment_ck` refuses a row without them. Old code writes none of
those: `fulfilment` takes its `DEFAULT 'IN_ROOM'`, `destination_label` stays
null, `visit_id` stays null, and every CHECK passes because every existing row
has a `stay_id`.

So: **migrate first, deploy second.** The window between them is safe, and a
deploy that fails leaves a database that the running code is still happy with.

---

## What actually happened, 13 October 2026

Each step behaved as written. Two things worth keeping:

- Between steps 1 and 2 the health check went **`degraded`** with
  `unknown: ["0008_property_links.sql"]` — the running old code noticing the
  database was ahead of it. That is the intended signal, not a fault, and it
  cleared when the code landed.
- The production `DATABASE_URL` for `app_user` contains an **unencoded `@` in
  the password** (two at-signs in the URL). `pg-connection-string` splits on
  the last one and parses it correctly, but anything doing its own parsing
  will get this wrong. It was tested before being relied on.

## 0. Confirm where production is

```bash
curl -s https://innstant.in/api/health | python3 -m json.tool
```

`migrations.applied` should read **8** before you start and **9** after step 1.
`db.status` must be `up`.

---

## 1. The migration

`0008_property_links.sql` ALTERs three populated tables. On this database —
one demo property, a few dozen orders — every statement below is
sub-second. On a large `orders` table the backfill and the two CHECK
validations would want more thought.

What it does, and what each costs:

- `ALTER COLUMN stay_id DROP NOT NULL` ×3 — metadata only, instant.
- `ADD COLUMN visit_id uuid REFERENCES visits(id)` ×3 — nullable with no
  default, so metadata only; the FK validates against all-NULL instantly.
- `ADD COLUMN fulfilment ... DEFAULT 'IN_ROOM' NOT NULL` — PG 11+ stores a
  non-volatile default in the catalogue rather than rewriting the table.
- `UPDATE orders SET destination_label = 'Room ' || r.number` — **this one
  writes rows.** Proportional to the order count.
- Four `ADD CONSTRAINT ... CHECK` — each scans its table once to validate.
  All four pass on existing data by construction: every current row has a
  `stay_id` and will take `IN_ROOM`.
- `DROP INDEX carts_stay_outlet_uq` then two partial `CREATE UNIQUE INDEX` —
  brief exclusive lock. NOT `CONCURRENTLY`, because the migration runner wraps
  each file in one transaction and `CONCURRENTLY` cannot run inside one. That
  is the right trade here and would not be on a busy table.

The whole file is ONE transaction. It applies completely or not at all.

```bash
# The owner role, never app_user (CLAUDE.md #2). The production URLs are in
# .env, commented out at lines 17-18 — deliberately, so that local tooling
# cannot point at production by accident. Pass it INLINE for this one command
# rather than uncommenting: `pnpm demo:reset` reads the same variable, and an
# uncommented production URL left in .env is how the live demo gets wiped by a
# command somebody runs out of habit.
DATABASE_MIGRATION_URL='<the commented-out URL from .env line 18>' pnpm db:migrate
```

Expect `→ 0008_property_links.sql ... applied` and a final line reporting
**58 tables with RLS enabled and forced** (56 before, plus `visits` and
`visit_links`).

Then confirm nothing moved under the running app:

```bash
curl -s https://innstant.in/api/health | python3 -m json.tool   # applied: 9, pending: []
curl -s -o /dev/null -w '%{http_code}\n' https://innstant.in/   # still 200
```

### If it fails

The transaction rolls back and production is untouched — the running code
never needed 0008. Read the error, fix it, run it again. There is no
half-applied state to clean up.

---

## 2. The code

There is **no git remote** (`docs/STATUS.md`, "Still needs somebody"), so
`railway up` ships the working tree rather than a commit. Make sure the tree is
clean and on the intended commit first, or you will ship uncommitted edits.

```bash
git status --short        # must be empty
git log --oneline -1      # 7079e2b or later

railway login             # opens a browser; cannot be done for you
railway link              # pick the project, then the `kesari` service
railway up
```

Watch the build, then:

```bash
curl -s https://innstant.in/api/health | python3 -m json.tool
curl -s -o /dev/null -w 'POST /api/v1/visits %{http_code}\n' \
  -X POST https://innstant.in/api/v1/visits \
  -H 'content-type: application/json' -d '{"code":"the-kesari-order"}'
```

The second should be **404** at this point, not 500 — the route now exists and
is correctly saying it has never heard of that link. Step 3 is what creates it.

### Rolling back

Railway keeps previous deployments; redeploy the one before this. The schema
can stay — old code is happy on it, which is the whole point of the ordering.

---

## 3. Reseed the demo

**This DELETEs and rebuilds the demo tenant.** It is designed to be run
repeatedly — the data is invented fixtures, not a customer's — but it is
destructive and it is pointed at production.

It is also not optional. Two reasons:

1. The seeded stays have **already expired**. The last production reseed was
   21 September and `DEMO_STAY_NIGHTS` is 14, so they ran out on 5 October.
   `/r/the-kesari-214` currently answers 404 for that reason alone.
2. The three property links (`the-kesari-table-4`, `-counter`, `-order`) are
   created by the seeder. Without it there are no links to open.

```bash
DATABASE_URL='<production app_user URL, .env line 17>' \
DATABASE_MIGRATION_URL='<production owner URL, .env line 18>' \
  pnpm demo:reset
```

It prints the room links and the three property links. Then:

```bash
curl -s -o /dev/null -w '/p/the-kesari-order  %{http_code}\n' https://innstant.in/p/the-kesari-order
curl -s -o /dev/null -w '/r/the-kesari-214    %{http_code}\n' https://innstant.in/r/the-kesari-214
curl -s -X POST https://innstant.in/api/v1/visits \
  -H 'content-type: application/json' -d '{"code":"the-kesari-order"}' | python3 -m json.tool
```

All three should answer. The last returns a token, a visit, the outlet and the
property — that is the app's front door working against production.

### `APP_URL`

`docs/STATUS.md` has carried this for three sessions: `APP_URL` on Railway
still names the railway subdomain rather than `innstant.in`, and it is what
printed sticker URLs are built from. The seeder prints links using it. Fix it
before any print run; it does not affect the app, which uses
`EXPO_PUBLIC_API_URL`.

---

## 4. The APK

Only after step 3. An APK built earlier points at a server with no `/api/v1`
and every screen fails on its first call.

This machine has **no Java and no Android SDK**, so a local build is not
possible without installing both. EAS builds in the cloud instead:

```bash
cd mobile
eas login                 # an Expo account; cannot be done for you
eas init                  # creates the project and writes its id to app.json
eas build --platform android --profile preview
```

`preview` is the profile to use and `eas.json` pins two things that matter:

- `"buildType": "apk"` — **EAS defaults Android to an AAB**, which is what the
  Play Store ingests and what a phone cannot install. An AAB handed to somebody
  to "just try it" is a file they cannot open.
- `EXPO_PUBLIC_API_URL: https://innstant.in` — baked in at build time. There is
  no runtime switch; an APK is permanently pointed at whatever this said when
  it was built.

EAS prints a download URL when it finishes. Install with `adb install <file>`
or by opening the link on the phone.

### Universal links will not verify yet

`app.json` declares `applinks:innstant.in` and an Android intent filter for
`/p`. Neither verifies until the deployment serves
`/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`,
and nothing serves them today. Until then a tapped link opens the web app —
which is a correct fallback, not a failure. Type or scan the code in the app
instead.

---

## What to check on the phone

The web target proved the screens and the API. What it could not prove is
anything native, so this is the list that is actually new information:

- Safe-area insets on a notched phone — the pinned cart pill and the checkout
  footer are the two that would collide with a home indicator.
- The keyboard: the cart's `KeyboardAvoidingView` has `behavior` set for iOS
  only and Android relies on its window soft-input mode. The phone field is
  near the bottom of a long form.
- `expo-secure-store` genuinely persisting — kill the app and reopen it; the
  menu should come straight back without re-entering a code. It no-ops on the
  web target, so this has never actually been exercised.
- The camera on a real table tent.
