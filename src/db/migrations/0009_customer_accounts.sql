-- 0009_customer_accounts.sql — D-081: who you are, separately from where you are
--
-- Read docs/CUSTOMER-ACCOUNTS-PROPOSAL.md before changing anything here.
--
-- ─── What this is, in one paragraph ────────────────────────────────────────
--
-- `guest_sessions` answers WHERE somebody is ordering from — a stay or a visit
-- — and expires with that context. A customer account answers WHO THEY ARE and
-- lasts weeks. Those are orthogonal, and folding the second into the first
-- breaks it three ways: the lifetimes differ, `num_nonnulls(stay_id, visit_id)
-- = 1` says a session is in exactly one context while an identity is in none,
-- and order history has to work with NO context at all.
--
-- So: a second, independent credential. `guest_sessions` is NOT TOUCHED by
-- this migration, which is the point.
--
-- ─── Everything here is additive ───────────────────────────────────────────
--
-- Three new tables and three new nullable columns. No column changes type, no
-- constraint is dropped, and the only table scanned is `guest_addresses`,
-- which starts empty. An app running the previous code is unaffected — it
-- writes none of these and reads none of them.

-- ── Enums ───────────────────────────────────────────────────────────────────

CREATE TYPE "customer_auth_method" AS ENUM ('OTP_SMS');
--> statement-breakpoint

-- ── Columns on existing tables ──────────────────────────────────────────────

-- How a phone number was LEARNT. A front desk typing one off a passport, a
-- checkout form taking whatever was typed, and an OTP proving control of the
-- handset are three different things, and without this they are
-- indistinguishable.
ALTER TABLE "guests" ADD COLUMN "phone_verified_at" timestamptz;
--> statement-breakpoint

-- Denormalised from the link. The account's history is DIRECT-link orders
-- only, and `orders.fulfilment` cannot express that: TAKEAWAY comes from both
-- a COUNTER link and an ONLINE one. `visit_link_id` is ON DELETE SET NULL, so
-- a join through `visit_links` would not survive a deleted link either.
ALTER TABLE "visits" ADD COLUMN "link_kind" "visit_link_kind";
--> statement-breakpoint

-- Backfill from the link each visit actually came from. Visits opened by staff
-- with no link keep NULL, which is the honest answer.
UPDATE "visits" v
   SET "link_kind" = l."kind"
  FROM "visit_links" l
 WHERE l."id" = v."visit_link_id"
   AND v."link_kind" IS NULL;
--> statement-breakpoint

-- Who placed it, when that was PROVED — stamped only where a customer session
-- was attached. Deliberately not "whoever this visit belongs to":
-- `visits.guest_id` already answers that, from a phone nobody verified.
ALTER TABLE "orders" ADD COLUMN "guest_id" uuid REFERENCES "guests"("id");
--> statement-breakpoint

-- Partial. The column is null for the large majority of rows — most orders in
-- this product are placed by people who never make an account, and #9 says
-- that must keep working — so an index over those is dead weight.
CREATE INDEX "orders_guest_idx" ON "orders" ("guest_id", "placed_at" DESC)
  WHERE "guest_id" IS NOT NULL;
--> statement-breakpoint

-- ── customer_sessions ───────────────────────────────────────────────────────
-- No property_id. An account is tenant-wide exactly as `guests` is: somebody
-- who orders from two properties in a group is one customer (EXTENSION-POINTS §2).

CREATE TABLE "customer_sessions" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"    uuid NOT NULL,
  "guest_id"     uuid NOT NULL REFERENCES "guests"("id") ON DELETE CASCADE,
  "token_hash"   text NOT NULL,
  "method"       "customer_auth_method" DEFAULT 'OTP_SMS' NOT NULL,
  "ip_address"   text,
  "user_agent"   text,
  "last_seen_at" timestamptz DEFAULT now() NOT NULL,
  "expires_at"   timestamptz NOT NULL,
  "revoked_at"   timestamptz,
  "created_at"   timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX "customer_sessions_token_hash_uq" ON "customer_sessions" ("token_hash");
--> statement-breakpoint
CREATE INDEX "customer_sessions_guest_idx" ON "customer_sessions" ("guest_id");
--> statement-breakpoint

-- The same 64-hex constraint 0002 puts on every other session token in this
-- product. It is what stops a plaintext token being stored by a code path that
-- forgot to hash — which is the one mistake in this area that cannot be
-- noticed by reading a screen.
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_token_hash_ck"
  CHECK ("token_hash" ~ '^[0-9a-f]{64}$');
--> statement-breakpoint

-- ── otp_challenges ──────────────────────────────────────────────────────────
-- Keyed on the PHONE and NOT on a guest, deliberately: a challenge must be
-- creatable for a number this tenant has never seen and be indistinguishable
-- from one for a number it knows, or the endpoint that creates it is an oracle
-- for "does this person have an account here".

CREATE TABLE "otp_challenges" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"    uuid NOT NULL,
  "phone"        text NOT NULL,
  "code_hash"    text NOT NULL,
  "attempts"     integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 5 NOT NULL,
  "locked_until" timestamptz,
  "consumed_at"  timestamptz,
  "expires_at"   timestamptz NOT NULL,
  "created_at"   timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Serves three questions at once: the newest live challenge for a number, the
-- resend throttle, and the lockout window.
CREATE INDEX "otp_challenges_phone_idx"
  ON "otp_challenges" ("tenant_id", "phone", "created_at" DESC);
--> statement-breakpoint

ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_code_hash_ck"
  CHECK ("code_hash" ~ '^[0-9a-f]{64}$');
--> statement-breakpoint

-- ── guest_addresses ─────────────────────────────────────────────────────────

CREATE TABLE "guest_addresses" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"   uuid NOT NULL,
  "guest_id"    uuid NOT NULL REFERENCES "guests"("id") ON DELETE CASCADE,
  "label"       text NOT NULL,
  "line"        text NOT NULL,
  "notes"       text,
  "is_default"  boolean DEFAULT false NOT NULL,
  "archived_at" timestamptz,
  "created_at"  timestamptz DEFAULT now() NOT NULL,
  "updated_at"  timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX "guest_addresses_guest_idx" ON "guest_addresses" ("guest_id", "is_default");
--> statement-breakpoint

-- At most one default per customer, and only among the LIVE ones — archiving a
-- default and adding another must not collide with it. Drizzle cannot express
-- a WHERE on a unique index, the same reason the one-active-stay-per-room
-- index lives in 0002 rather than in the schema file.
CREATE UNIQUE INDEX "guest_addresses_one_default_uq" ON "guest_addresses" ("guest_id")
  WHERE "is_default" AND "archived_at" IS NULL;
--> statement-breakpoint

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- 0001's loop runs once, at 0001. A table added later ships WIDE OPEN without
-- its own policy, and app_user would read every tenant's rows because 0001
-- granted DML on ALL TABLES plus default privileges for anything created
-- afterwards. 0008 had to do this too.

ALTER TABLE "customer_sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "customer_sessions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "customer_sessions";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "customer_sessions"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "otp_challenges" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "otp_challenges" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "otp_challenges";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "otp_challenges"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "guest_addresses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "guest_addresses" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "guest_addresses";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "guest_addresses"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE
  ON "customer_sessions", "otp_challenges", "guest_addresses" TO app_user;
