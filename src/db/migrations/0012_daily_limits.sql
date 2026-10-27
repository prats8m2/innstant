-- 0012_daily_limits.sql — D-086: "only 20 today"
--
-- A kitchen makes twenty portions of the laal maas, and the twenty-first
-- guest should see "sold out today" on the menu, not order it and have it
-- rejected. Until now the only tool was the 86 switch, flipped by hand once
-- somebody noticed the pot was empty.
--
--   menu_items.daily_limit   how many a day; NULL is no limit (most dishes).
--   menu_item_daily_sales    how many have gone, per dish per property-local
--                            day. Owned by the catalog module, written only by
--                            claimDailyPortions() / releaseDailyPortions().
--
-- ─── Why a counter, and why it cannot oversell ─────────────────────────────
--
-- Counting order_items would be the ordering module's table read by the
-- catalog (D-001 forbids it), and a count then insert is a race: two guests
-- reading "19 sold" both order the twentieth. Instead placeOrder(), inside its
-- own transaction, asks catalog to CLAIM the portions with one statement: an
-- upsert that only adds if the total stays within the limit. Concurrent
-- claims on one dish queue on that row's lock, so the last portion goes to
-- exactly one of them and the other's whole order rolls back with "only N
-- left today". A rejected or cancelled order releases what it claimed.
--
-- `business_date` is the hotel's calendar date at the moment of the order.
-- A sale at 00:30 counts towards the new day, like a collection's dates.

ALTER TABLE "menu_items" ADD COLUMN "daily_limit" integer;
--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_daily_limit_positive"
  CHECK ("daily_limit" IS NULL OR "daily_limit" > 0);
--> statement-breakpoint

CREATE TABLE "menu_item_daily_sales" (
  "tenant_id"      uuid NOT NULL,
  "menu_item_id"   uuid NOT NULL REFERENCES "menu_items"("id") ON DELETE CASCADE,
  "business_date"  date NOT NULL,
  "sold"           integer DEFAULT 0 NOT NULL CHECK ("sold" >= 0),
  "updated_at"     timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY ("menu_item_id", "business_date")
);
--> statement-breakpoint

ALTER TABLE "menu_item_daily_sales" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "menu_item_daily_sales" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "menu_item_daily_sales";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "menu_item_daily_sales"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "menu_item_daily_sales" TO app_user;
