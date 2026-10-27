-- 0011_menu_offers.sql — D-085: automatic offers on the menu
--
-- "20% off sweets, 3 to 6", "₹100 off the laal maas tonight", "10% off
-- everything for Diwali". No coupon codes, by the user's choice: an offer
-- applies by itself to whoever orders while it is live. Never stacked: the
-- single best offer for a dish is the one that applies.
--
-- ─── Not `promotions` ───────────────────────────────────────────────────────
--
-- That name is reserved for the booking module (CLAUDE.md #12,
-- docs/EXTENSION-POINTS.md). These are offers ON THE MENU, which is what the
-- table is called.
--
-- ─── What an offer is ──────────────────────────────────────────────────────
--
--   scope        DISH (menu_item_id), CATEGORY (category_id), or MENU (the
--                outlet's whole menu). A CHECK keeps the ids honest to it.
--   kind         PERCENT (percent_bps, 1–10000) or AMOUNT (amount_minor > 0,
--                in `currency`; #5: every row holding an amount says which).
--                A CHECK keeps exactly one of the two set.
--   schedule     the same four as a collection (D-084): a time window, days
--                of the week, and property-local dates. A late window belongs
--                to the day it started. Read by isCollectionLive().
--
-- The discount comes off the DISH's price, not its modifiers: "20% off the
-- laal maas" is 20% off ₹1,150, and the extra roti is still ₹90. An AMOUNT
-- offer never takes a dish below zero.
--
-- ─── The receipt (#6) ──────────────────────────────────────────────────────
--
-- order_items.unit_price_minor already IS the price sold at, so an order
-- placed during happy hour keeps happy hour's price for ever without any of
-- this table. What it could not keep is WHY: a receipt reading ₹920 for a
-- ₹1,150 dish with no explanation is a dispute. So each line also snapshots
-- the price it would have been (list_price_minor) and the offer's name.
-- offer_id is analytics only, ON DELETE SET NULL, like menu_item_id.
--
-- Additive: a new table, and three nullable columns that code from before
-- this migration never reads or writes.

CREATE TYPE "menu_offer_scope" AS ENUM ('DISH', 'CATEGORY', 'MENU');
--> statement-breakpoint
CREATE TYPE "menu_offer_kind" AS ENUM ('PERCENT', 'AMOUNT');
--> statement-breakpoint

CREATE TABLE "menu_offers" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"       uuid NOT NULL,
  "property_id"     uuid NOT NULL,
  "outlet_id"       uuid NOT NULL REFERENCES "outlets"("id") ON DELETE CASCADE,
  "name"            text NOT NULL,
  "scope"           "menu_offer_scope" NOT NULL,
  "menu_item_id"    uuid REFERENCES "menu_items"("id"),
  "category_id"     uuid REFERENCES "menu_categories"("id"),
  "kind"            "menu_offer_kind" NOT NULL,
  "percent_bps"     integer,
  "amount_minor"    integer,
  "currency"        text DEFAULT 'INR' NOT NULL,
  "available_from"  text,
  "available_until" text,
  "days_of_week"    smallint[],
  "starts_on"       date,
  "ends_on"         date,
  "is_active"       boolean DEFAULT true NOT NULL,
  "archived_at"     timestamptz,
  "created_at"      timestamptz DEFAULT now() NOT NULL,
  "updated_at"      timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX "menu_offers_outlet_idx" ON "menu_offers" ("outlet_id")
  WHERE "archived_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "menu_offers" ADD CONSTRAINT "menu_offers_scope_target" CHECK (
     ("scope" = 'DISH'     AND "menu_item_id" IS NOT NULL AND "category_id" IS NULL)
  OR ("scope" = 'CATEGORY' AND "category_id"  IS NOT NULL AND "menu_item_id" IS NULL)
  OR ("scope" = 'MENU'     AND "menu_item_id" IS NULL     AND "category_id" IS NULL)
);
--> statement-breakpoint

ALTER TABLE "menu_offers" ADD CONSTRAINT "menu_offers_amount" CHECK (
     ("kind" = 'PERCENT' AND "percent_bps" BETWEEN 1 AND 10000 AND "amount_minor" IS NULL)
  OR ("kind" = 'AMOUNT'  AND "amount_minor" > 0               AND "percent_bps" IS NULL)
);
--> statement-breakpoint

ALTER TABLE "menu_offers" ADD CONSTRAINT "menu_offers_days_of_week_valid" CHECK (
  "days_of_week" IS NULL
  OR (
    cardinality("days_of_week") BETWEEN 1 AND 7
    AND "days_of_week" <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::smallint[]
  )
);
--> statement-breakpoint

ALTER TABLE "menu_offers" ADD CONSTRAINT "menu_offers_dates_ordered" CHECK (
  "starts_on" IS NULL OR "ends_on" IS NULL OR "ends_on" >= "starts_on"
);
--> statement-breakpoint

ALTER TABLE "menu_offers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "menu_offers" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "menu_offers";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "menu_offers"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "menu_offers" TO app_user;
--> statement-breakpoint

-- ── The receipt ────────────────────────────────────────────────────────────

ALTER TABLE "order_items" ADD COLUMN "list_price_minor" integer;
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "offer_id" uuid
  REFERENCES "menu_offers"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "offer_name_snapshot" text;
--> statement-breakpoint

-- An offer only ever takes money off: the price before it is never below the
-- price sold at, and a line has both or neither.
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_offer_snapshot" CHECK (
     ("list_price_minor" IS NULL AND "offer_name_snapshot" IS NULL)
  OR ("list_price_minor" IS NOT NULL AND "offer_name_snapshot" IS NOT NULL
      AND "list_price_minor" >= "unit_price_minor")
);
