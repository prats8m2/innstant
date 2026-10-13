-- 0008_property_links.sql — D-079: a property link, and the visit behind it
--
-- Until now every ordering context in this product was a STAY, and every stay
-- is a room. A restaurant has neither. This migration adds the sibling: a
-- `visit`, opened by a link that points at an OUTLET rather than a room.
--
-- ─── The shape of the change, and why it is cheap ──────────────────────────
--
-- EXTENSION-POINTS states the rule this follows: adding a table, adding a
-- nullable column and adding an enum value are all effectively free and online;
-- changing a unique constraint on a populated table is the expensive kind. So
-- the three tables that anchor on a stay (`guest_sessions`, `carts`, `orders`)
-- keep their column, gain a nullable sibling, and get a CHECK that exactly one
-- is set. No row is rewritten and no existing query changes meaning.
--
-- The one constraint that genuinely had to be replaced is `carts_stay_outlet_uq`,
-- and the reason is a Postgres fact rather than a preference: NULL is distinct
-- from NULL, so a composite unique index over a now-nullable column stops
-- constraining the rows where it is null. Two PARTIAL indexes say what the one
-- index used to say, for each half.
--
-- Backfill is `UPDATE ... SET destination_label` over existing orders. It reads
-- the room number through the stay, which is exactly the join the KDS used to
-- do on every render and will now never do again.

-- ── Enums ───────────────────────────────────────────────────────────────────

CREATE TYPE "fulfilment_mode" AS ENUM ('IN_ROOM', 'DINE_IN', 'TAKEAWAY', 'DELIVERY');
--> statement-breakpoint
CREATE TYPE "visit_link_kind" AS ENUM ('TABLE', 'COUNTER', 'ONLINE');
--> statement-breakpoint
CREATE TYPE "visit_status" AS ENUM ('OPEN', 'CLOSED');
--> statement-breakpoint

-- ── visit_links ─────────────────────────────────────────────────────────────

CREATE TABLE "visit_links" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"    uuid NOT NULL,
  "property_id"  uuid NOT NULL,
  "outlet_id"    uuid NOT NULL REFERENCES "outlets"("id"),
  "public_code"  text NOT NULL,
  "kind"         "visit_link_kind" DEFAULT 'ONLINE' NOT NULL,
  "label"        text NOT NULL,
  "table_label"  text,
  "version"      integer DEFAULT 1 NOT NULL,
  "revoked_at"   timestamptz,
  "created_at"   timestamptz DEFAULT now() NOT NULL,
  "updated_at"   timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Globally unique, like `room_qr_codes.public_code`: the scan resolves the
-- tenant FROM the code, so it cannot be scoped to a property at lookup time.
CREATE UNIQUE INDEX "visit_links_public_code_uq" ON "visit_links" ("public_code");
--> statement-breakpoint
CREATE INDEX "visit_links_property_idx" ON "visit_links" ("property_id", "outlet_id");
--> statement-breakpoint

-- A table tent needs its table; nothing else may carry one. Without this,
-- "Table 4" ends up on a delivery ticket because a form posted a stale field.
ALTER TABLE "visit_links" ADD CONSTRAINT "visit_links_table_label_ck"
  CHECK (("kind" = 'TABLE') = ("table_label" IS NOT NULL));
--> statement-breakpoint

-- ── visits ──────────────────────────────────────────────────────────────────

CREATE TABLE "visits" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"        uuid NOT NULL,
  "property_id"      uuid NOT NULL,
  "outlet_id"        uuid NOT NULL REFERENCES "outlets"("id"),
  "visit_link_id"    uuid REFERENCES "visit_links"("id") ON DELETE SET NULL,
  "status"           "visit_status" DEFAULT 'OPEN' NOT NULL,
  "fulfilment"       "fulfilment_mode" DEFAULT 'DINE_IN' NOT NULL,
  "customer_name"    text,
  "customer_phone"   text,
  "table_label"      text,
  "delivery_address" text,
  "delivery_notes"   text,
  "guest_id"         uuid REFERENCES "guests"("id"),
  "expires_at"       timestamptz NOT NULL,
  "closed_at"        timestamptz,
  "created_at"       timestamptz DEFAULT now() NOT NULL,
  "updated_at"       timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX "visits_property_status_idx" ON "visits" ("property_id", "status");
--> statement-breakpoint
CREATE INDEX "visits_outlet_idx" ON "visits" ("outlet_id", "created_at");
--> statement-breakpoint
CREATE INDEX "visits_link_idx" ON "visits" ("visit_link_id");
--> statement-breakpoint

-- IN_ROOM belongs to a stay. A visit that claimed it would put a restaurant
-- order on the room board with no room behind it.
ALTER TABLE "visits" ADD CONSTRAINT "visits_fulfilment_ck"
  CHECK ("fulfilment" <> 'IN_ROOM');
--> statement-breakpoint

-- A delivery with no address is a tray nobody can carry anywhere. Enforced
-- here rather than only in the form, because the form is a UI affordance and a
-- UI affordance is not a control — the same reasoning as placeOrder()'s tier
-- assertion.
ALTER TABLE "visits" ADD CONSTRAINT "visits_delivery_address_ck"
  CHECK ("fulfilment" <> 'DELIVERY' OR "customer_name" IS NULL
         OR "delivery_address" IS NOT NULL);
--> statement-breakpoint

-- ── guest_sessions: a stay OR a visit ───────────────────────────────────────

ALTER TABLE "guest_sessions" ALTER COLUMN "stay_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD COLUMN "visit_id" uuid REFERENCES "visits"("id");
--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD CONSTRAINT "guest_sessions_context_ck"
  CHECK (num_nonnulls("stay_id", "visit_id") = 1);
--> statement-breakpoint
CREATE INDEX "guest_sessions_visit_idx" ON "guest_sessions" ("visit_id");
--> statement-breakpoint

-- ── carts: a stay OR a visit ────────────────────────────────────────────────

ALTER TABLE "carts" ALTER COLUMN "stay_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "visit_id" uuid REFERENCES "visits"("id");
--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_context_ck"
  CHECK (num_nonnulls("stay_id", "visit_id") = 1);
--> statement-breakpoint

-- The replacement described at the top: NULL is distinct from NULL, so the old
-- composite index would stop constraining visit carts entirely.
DROP INDEX IF EXISTS "carts_stay_outlet_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "carts_stay_outlet_uq" ON "carts" ("stay_id", "outlet_id")
  WHERE "stay_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "carts_visit_outlet_uq" ON "carts" ("visit_id", "outlet_id")
  WHERE "visit_id" IS NOT NULL;
--> statement-breakpoint

-- ── orders: a stay OR a visit, and where the tray goes ──────────────────────

ALTER TABLE "orders" ALTER COLUMN "stay_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "visit_id" uuid REFERENCES "visits"("id");
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fulfilment" "fulfilment_mode"
  DEFAULT 'IN_ROOM' NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "destination_label" text;
--> statement-breakpoint

-- Backfill: every existing order is a room order, and this is the last time
-- anything joins orders → stays → rooms to find out where it goes.
UPDATE "orders" o
   SET "destination_label" = 'Room ' || r."number"
  FROM "stays" s
  JOIN "rooms" r ON r."id" = s."room_id"
 WHERE s."id" = o."stay_id"
   AND o."destination_label" IS NULL;
--> statement-breakpoint

ALTER TABLE "orders" ADD CONSTRAINT "orders_context_ck"
  CHECK (num_nonnulls("stay_id", "visit_id") = 1);
--> statement-breakpoint

-- A stay order is IN_ROOM and a visit order is not. The two discriminators
-- cannot be allowed to disagree: a ticket reading "Table 4" against a stay
-- would send a runner to a table that does not exist.
ALTER TABLE "orders" ADD CONSTRAINT "orders_fulfilment_ck"
  CHECK (("stay_id" IS NOT NULL) = ("fulfilment" = 'IN_ROOM'));
--> statement-breakpoint

CREATE INDEX "orders_visit_idx" ON "orders" ("visit_id");
--> statement-breakpoint

-- ── RLS on the two new tables ───────────────────────────────────────────────
-- 0001's loop runs once, at its own migration. A table added later must bring
-- its own policy or it ships wide open — and app_user would read every hotel's
-- tables because the GRANT in 0001 covers ALL TABLES plus default privileges.

ALTER TABLE "visit_links" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "visit_links" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "visit_links";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "visit_links"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "visits" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "visits" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "visits";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "visits"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "visit_links", "visits" TO app_user;
--> statement-breakpoint

-- ── The pre-tenant routing lookup ───────────────────────────────────────────
-- The visit-side twin of `resolve_qr_routing` (0003). Read that file's header
-- for why this has to be SECURITY DEFINER and why it returns ids and nothing
-- else: somebody arriving at /p/{code} carries no tenant, so the policies above
-- correctly return zero rows, and without this a link could never resolve.
--
-- Note what it returns and what it does not. Routing ids, the kind, the table
-- label and the revocation — enough to open a menu. No customer, no order, no
-- total. Knowing a public code grants outlet context, exactly as knowing a room
-- code grants room context.

CREATE OR REPLACE FUNCTION resolve_visit_link(p_public_code text)
RETURNS TABLE (
  tenant_id     uuid,
  property_id   uuid,
  outlet_id     uuid,
  visit_link_id uuid,
  kind          visit_link_kind,
  table_label   text,
  version       integer,
  revoked_at    timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
-- Pinned, mandatory for SECURITY DEFINER: without it a caller could shadow
-- `visit_links` with a temp table and have the definer read theirs instead.
SET search_path = public, pg_temp
AS $$
  SELECT l.tenant_id, l.property_id, l.outlet_id, l.id, l.kind,
         l.table_label, l.version, l.revoked_at
  FROM public.visit_links l
  WHERE l.public_code = p_public_code
  LIMIT 1;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION resolve_visit_link(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_visit_link(text) TO app_user;
--> statement-breakpoint

COMMENT ON FUNCTION resolve_visit_link(text) IS
  'Pre-tenant routing lookup for /p/[code]. Returns routing ids only — never '
  'customer, order or total data. Everything downstream goes through withTenant().';
