-- 0006_staff_invites.sql — turning an INVITED row into somebody who can sign in
--
-- `provisionProperty()` has created exactly one PROPERTY_ADMIN as INVITED with
-- `password_hash` NULL since P0, and S5 never built the flow that fills it in.
-- So a hotel's second staff member was a seeder run, and the first one could
-- only sign in because the demo seeder wrote their password directly. P3.5.
--
-- There is no mail provider in this product and adding one is a decision rather
-- than a session (CLAUDE.md "Ask before"), so the invite is a LINK a manager
-- copies and hands over — the same shape as the guest link on the room list, and
-- the same shape as what a mail provider would send if one existed. When mail
-- arrives it sends this link and nothing here changes.
--
-- Hand-written and numbered to sit after 0005. `db:migrate` applies files in
-- filename order and tracks them by filename.

CREATE TABLE "staff_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by_staff_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "staff_invites"
  ADD CONSTRAINT "staff_invites_staff_user_id_fk"
  FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE cascade;
--> statement-breakpoint

-- The token is the credential, so it is unique across the whole table and stored
-- as SHA-256 only — same rule as `staff_sessions.token_hash` and guest sessions
-- (#10). The plaintext exists once, in the response that created it.
CREATE UNIQUE INDEX "staff_invites_token_hash_uq" ON "staff_invites" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX "staff_invites_staff_idx" ON "staff_invites" USING btree ("staff_user_id");
--> statement-breakpoint

-- ── One live invite per person ──────────────────────────────────────────────
-- Same shape as D-007's one-CHECKED_IN-stay-per-room and the one-open-checkout-
-- request index in 0005. Two live invites for one account means two working
-- links, and revoking the one the manager can see leaves the other alive — which
-- is the opposite of what they just did. Re-inviting revokes first, so the newest
-- link is always the only one.
CREATE UNIQUE INDEX "staff_invites_one_live_per_staff"
  ON "staff_invites" ("staff_user_id")
  WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;
--> statement-breakpoint

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- 0001's verification block runs before this table exists, so it cannot catch a
-- table added later. Every new tenant-scoped table enables its own policy here,
-- and the isolation suite asserts the whole set.

ALTER TABLE "staff_invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staff_invites" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "staff_invites";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "staff_invites"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "staff_invites" TO app_user;
