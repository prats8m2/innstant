-- 0001_rls.sql — row-level security
--
-- D-005: isolation is enforced by Postgres, not by application filtering.
-- A forgotten `WHERE tenant_id = ...` becomes a returns-nothing bug instead of
-- a cross-hotel leak.
--
-- This only works if the app connects as a role that owns nothing and lacks
-- BYPASSRLS (CLAUDE.md #2). Table owners and superusers bypass RLS SILENTLY —
-- if RLS ever appears "not to work", check `select current_user` before
-- touching a policy. This file runs as the OWNER role via
-- DATABASE_MIGRATION_URL; the app connects as app_user.
--
-- Policies read `app.tenant_id`, set per transaction by withTenant() using
-- set_config(..., true). Never a bare SET — with PgBouncer in transaction
-- pooling mode a session-scoped GUC leaks across requests (CLAUDE.md #3).
--
-- The nullif() is load-bearing, not defensive noise. After a transaction that
-- used set_config(..., true) commits, the GUC does NOT revert to unset — it
-- reverts to the EMPTY STRING. `''::uuid` raises 22P02, so without nullif a
-- query issued outside withTenant() errors with a cast failure instead of
-- matching zero rows. nullif('','') is NULL, and `uuid = NULL` is NULL rather
-- than true, which gives the intended failure mode: return nothing, never
-- everything. Verified against PG 18 — see tests in S4.

-- ── Role grants ─────────────────────────────────────────────────────────────
-- app_user owns nothing. It gets DML on the tables and nothing else.

GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;

-- No sequences today (uuid PKs), but a future serial must not break the app.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- app_user must never be able to turn RLS off on a table it does not own.
REVOKE CREATE ON SCHEMA public FROM app_user;

-- ── tenants ─────────────────────────────────────────────────────────────────
-- The only table with no tenant_id: its own id IS the tenant.

ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "tenants";
CREATE POLICY tenant_isolation ON "tenants"
  USING ("id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- ── Every tenant-scoped table ───────────────────────────────────────────────
-- USING governs what can be READ; WITH CHECK governs what can be WRITTEN.
-- Both are required: USING alone would let tenant A insert a row stamped with
-- tenant B's id and then be unable to see its own mistake.

ALTER TABLE "access_escalations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "access_escalations" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "access_escalations";
CREATE POLICY tenant_isolation ON "access_escalations"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "access_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "access_policies" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "access_policies";
CREATE POLICY tenant_isolation ON "access_policies"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "cart_item_modifiers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cart_item_modifiers" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "cart_item_modifiers";
CREATE POLICY tenant_isolation ON "cart_item_modifiers"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "cart_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cart_items" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "cart_items";
CREATE POLICY tenant_isolation ON "cart_items"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "carts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "carts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "carts";
CREATE POLICY tenant_isolation ON "carts"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "checkout_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "checkout_requests" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "checkout_requests";
CREATE POLICY tenant_isolation ON "checkout_requests"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "collection_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "collection_items" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "collection_items";
CREATE POLICY tenant_isolation ON "collection_items"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "collections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "collections" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "collections";
CREATE POLICY tenant_isolation ON "collections"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "event_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "event_log" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "event_log";
CREATE POLICY tenant_isolation ON "event_log"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "floors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "floors" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "floors";
CREATE POLICY tenant_isolation ON "floors"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "folio_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "folio_lines" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "folio_lines";
CREATE POLICY tenant_isolation ON "folio_lines"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "folios" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "folios" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "folios";
CREATE POLICY tenant_isolation ON "folios"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "guest_property_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "guest_property_profiles" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "guest_property_profiles";
CREATE POLICY tenant_isolation ON "guest_property_profiles"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "guest_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "guest_sessions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "guest_sessions";
CREATE POLICY tenant_isolation ON "guest_sessions"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "guests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "guests" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "guests";
CREATE POLICY tenant_isolation ON "guests"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "idempotency_keys" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "idempotency_keys";
CREATE POLICY tenant_isolation ON "idempotency_keys"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "integration_outbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integration_outbox" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "integration_outbox";
CREATE POLICY tenant_isolation ON "integration_outbox"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "itineraries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "itineraries" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "itineraries";
CREATE POLICY tenant_isolation ON "itineraries"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "itinerary_stops" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "itinerary_stops" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "itinerary_stops";
CREATE POLICY tenant_isolation ON "itinerary_stops"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "menu_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "menu_categories" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "menu_categories";
CREATE POLICY tenant_isolation ON "menu_categories"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "menu_item_availability_windows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "menu_item_availability_windows" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "menu_item_availability_windows";
CREATE POLICY tenant_isolation ON "menu_item_availability_windows"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "menu_item_modifier_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "menu_item_modifier_groups" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "menu_item_modifier_groups";
CREATE POLICY tenant_isolation ON "menu_item_modifier_groups"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "menu_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "menu_items" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "menu_items";
CREATE POLICY tenant_isolation ON "menu_items"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "modifier_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "modifier_groups" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "modifier_groups";
CREATE POLICY tenant_isolation ON "modifier_groups"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "modifier_options" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "modifier_options" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "modifier_options";
CREATE POLICY tenant_isolation ON "modifier_options"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "notifications";
CREATE POLICY tenant_isolation ON "notifications"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "order_item_modifiers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_item_modifiers" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "order_item_modifiers";
CREATE POLICY tenant_isolation ON "order_item_modifiers"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_items" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "order_items";
CREATE POLICY tenant_isolation ON "order_items"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "orders";
CREATE POLICY tenant_isolation ON "orders"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "outlet_hours" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outlet_hours" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "outlet_hours";
CREATE POLICY tenant_isolation ON "outlet_hours"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "outlets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outlets" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "outlets";
CREATE POLICY tenant_isolation ON "outlets"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "payments";
CREATE POLICY tenant_isolation ON "payments"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "pois" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pois" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "pois";
CREATE POLICY tenant_isolation ON "pois"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "properties" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "properties" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "properties";
CREATE POLICY tenant_isolation ON "properties"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "request_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "request_types" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "request_types";
CREATE POLICY tenant_isolation ON "request_types"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "role_permissions";
CREATE POLICY tenant_isolation ON "role_permissions"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "roles";
CREATE POLICY tenant_isolation ON "roles"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "room_qr_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "room_qr_codes" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "room_qr_codes";
CREATE POLICY tenant_isolation ON "room_qr_codes"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "room_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "room_types" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "room_types";
CREATE POLICY tenant_isolation ON "room_types"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "rooms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rooms" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "rooms";
CREATE POLICY tenant_isolation ON "rooms"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "service_request_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_request_items" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "service_request_items";
CREATE POLICY tenant_isolation ON "service_request_items"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "service_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_requests" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "service_requests";
CREATE POLICY tenant_isolation ON "service_requests"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "shift_zones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shift_zones" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "shift_zones";
CREATE POLICY tenant_isolation ON "shift_zones"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "shifts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shifts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "shifts";
CREATE POLICY tenant_isolation ON "shifts"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "staff_property_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_property_roles" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "staff_property_roles";
CREATE POLICY tenant_isolation ON "staff_property_roles"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "staff_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_sessions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "staff_sessions";
CREATE POLICY tenant_isolation ON "staff_sessions"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "staff_users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_users" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "staff_users";
CREATE POLICY tenant_isolation ON "staff_users"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "staff_vouches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_vouches" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "staff_vouches";
CREATE POLICY tenant_isolation ON "staff_vouches"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "stays" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stays" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "stays";
CREATE POLICY tenant_isolation ON "stays"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "verification_challenges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification_challenges" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "verification_challenges";
CREATE POLICY tenant_isolation ON "verification_challenges"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- ── event_log is append-only ────────────────────────────────────────────────
-- CLAUDE.md #7 / D-010. This one table is the audit trail, the SLA analytics
-- source, and the dispute record. If it can be rewritten it is none of those.
-- Revoked at the privilege level, so it holds even if a policy is misedited.

REVOKE UPDATE, DELETE ON "event_log" FROM app_user;

-- ── Verification ────────────────────────────────────────────────────────────
-- Fails the migration loudly rather than leaving a table quietly unprotected.
-- A single unprotected tenant-scoped table is a cross-hotel leak, and it would
-- otherwise be invisible until someone went looking.

DO $$
DECLARE unprotected text[];
BEGIN
  SELECT array_agg(c.relname ORDER BY c.relname) INTO unprotected
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname <> '__drizzle_migrations'
    AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity);

  IF unprotected IS NOT NULL THEN
    RAISE EXCEPTION 'RLS not enabled/forced on: %', array_to_string(unprotected, ', ');
  END IF;
END $$;
