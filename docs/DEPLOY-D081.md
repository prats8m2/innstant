# Shipping customer accounts

The runbook for getting `0009`, the customer-account module and the app's
account screens into production. Same shape as `DEPLOY-D079-D080.md`, which
should be read first — the reasoning about ordering is there and is not
repeated here.

Written against a production on `328bbb0` with 9 migrations applied
(`0008_property_links.sql` latest), health `ok`.

---

## Why the order is the same order

| | old schema | new schema |
|---|---|---|
| **old code** (`328bbb0`) | what is live now | **fine** |
| **new code** | **BREAKS** | the target |

New code reads `customer_sessions`, `otp_challenges` and `guest_addresses`,
and stamps `orders.guest_id`. None of those exist on the old schema, so every
account route 500s against it.

Old code on the new schema writes none of them: every column 0009 adds to an
existing table is **nullable with no default**, and the three new tables are
simply never read. So, again: **migrate first, deploy second**, and a failed
deploy leaves a database the running code is still happy with.

0009 is smaller and safer than 0008 was. It adds three tables, one enum, six
indexes and three RLS policies; it ALTERs four existing tables and every one
of those is a nullable `ADD COLUMN`, which is a catalogue change rather than
a table rewrite. There is no backfill and no new CHECK on populated data —
the two things that made 0008 worth timing. The only `DROP` statements are
`DROP POLICY IF EXISTS` on the tables being created in the same file, which
is the idempotency guard, not a change to anything live.

The whole file is ONE transaction.

## 0. Confirm where production is

```bash
curl -s https://innstant.in/api/health | python3 -m json.tool
```

`migrations.applied` should read **9** before and **10** after step 1.
`db.status` must be `up`.

## 1. The migration

```bash
# The owner role, never app_user (CLAUDE.md #2). The production URLs are in
# .env, commented out at lines 17-18. Pass it INLINE rather than uncommenting
# — `pnpm demo:reset` reads the same variable, and an uncommented production
# URL left in .env is how the live demo gets wiped out of habit.
DATABASE_MIGRATION_URL='<the commented-out URL from .env line 18>' pnpm db:migrate
```

Expect `→ 0009_customer_accounts.sql ... applied` and a final line reporting
**59 tables with RLS enabled and forced** — the number this migration produces
on a local database that has every migration applied, checked rather than
derived. (Arithmetic on the previous runbook's figure gives 61, which is
wrong; that number was not re-measured when it was written. The only table in
`public` without forced RLS is `__drizzle_migrations`, which is the migration
ledger and belongs to the migration role.)

If production reports a different total, stop and find out why before step 2:
the three new tables must each come back `relrowsecurity` **and**
`relforcerowsecurity`, and a missing policy is a cross-tenant leak with no
error attached (CLAUDE.md #2).

```sql
SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
WHERE relname IN ('customer_sessions','otp_challenges','guest_addresses');
```

Between this and step 2 the health check will read **`degraded`** with
`unknown: ["0009_customer_accounts.sql"]` — the running old code noticing the
database is ahead of it. That is the intended signal, exactly as it was for
0008, and it clears when the code lands.

```bash
curl -s https://innstant.in/api/health | python3 -m json.tool   # applied: 10
curl -s -o /dev/null -w '%{http_code}\n' https://innstant.in/   # still 200
```

### If it fails

The transaction rolls back and production is untouched — the running code
never needed 0009. There is no half-applied state to clean up.

**Do not amend `0009_customer_accounts.sql` after it has been applied
anywhere.** The runner records the filename, not a hash, so an amended file is
silently skipped on a database that already has the old one. That cost a full
integration run this session (28 files failing on a column that the file
claimed to add) and was only safe to fix by rolling back locally because 0009
was not yet deployed. After this step it is deployed, and the next change is
`0010`.

## 2. The code

There is still **no git remote**, so `railway up` ships the working tree.

```bash
git status --short        # must be empty
git log --oneline -1      # dce47cb or later
railway up
```

Then:

```bash
curl -s https://innstant.in/api/health | python3 -m json.tool

# The account front door, with no context token — this is the request that
# proves identity does not live inside a visit (D-081).
curl -s -o /dev/null -w 'GET  /api/v1/auth/me   %{http_code}  (expect 401)\n' \
  https://innstant.in/api/v1/auth/me

# And the OTP path, which needs a visit token.
TOKEN=$(curl -s -X POST https://innstant.in/api/v1/visits \
  -H 'content-type: application/json' -d '{"code":"the-kesari-order"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -s -X POST https://innstant.in/api/v1/auth/otp/request \
  -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" \
  -d '{"phone":"9829011111"}'
```

The last returns `{"sent":true,"expiresInMinutes":10}`.

### Where the code actually goes

**There is no SMS provider configured in production.** `OtpSender` is a
pluggable interface and the only implementation is `ConsoleOtpSender`, which
writes the code to the server log at `warn` level with the phone redacted:

```
OTP NOT SENT — no SMS provider configured. The code is in this log line.
```

So on production today, signing in requires reading `railway logs`. That is
fine for a demo and is **not** fine for anybody real, and it is the one thing
standing between this feature and a customer using it. It fails loudly rather
than quietly on purpose: the log line says NOT SENT, and nothing anywhere
pretends a message went out.

## 3. Reseed — NOT needed

Unlike 0008, nothing here is created by the seeder. The demo property, its
three links and its menu are all already in production from the 13 October
reseed. 0009 adds tables that start empty and fill themselves as people sign
in.

Reseed anyway if the stays have expired again — `DEMO_STAY_NIGHTS` is 14 and
the last reseed was 13 October, so `/r/*` stops answering on **27 October
2026**. That affects room service only; the `/p/*` links and the whole app do
not expire.

## 4. The APK

Only after step 2, and the reasoning is unchanged from
`DEPLOY-D079-D080.md` §4: a build pointing at a server without these routes
fails on the account screen's first call.

```bash
cd mobile
EXPO_TOKEN=$(cat ../.eas-token) npx eas-cli@latest build \
  --platform android --profile preview --non-interactive --no-wait
```

`preview` is the profile that produces an **APK**. `production` produces an
AAB, which cannot be sideloaded — that distinction is in `mobile/eas.json`
and in `mobile/README.md`.

### Verify the artifact rather than the build log

Open the archive. The checks that caught real problems before:

```bash
unzip -l app.apk | grep -c 'classes.*\.dex'      # >0 — an APK, not an AAB
unzip -l app.apk | grep -E 'META-INF/.*\.(RSA|SF)'  # v1; absent is fine if
                                                   # the Signing Block is there
# And the one that matters most — what server it points at:
unzip -p app.apk assets/index.android.bundle | grep -c 'https://innstant.in'
unzip -p app.apk assets/index.android.bundle | grep -c 'localhost\|10\.0\.2\.2'
```

The last must be **0**. `EXPO_PUBLIC_*` values are inlined into the bundle at
build time, so a `.env` left pointing at a laptop ships that way silently.
