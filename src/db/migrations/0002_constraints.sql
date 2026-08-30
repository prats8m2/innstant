-- 0002_constraints.sql — invariants Drizzle cannot express
--
-- Everything here is a rule that must hold no matter which code path writes.
-- Application-level checks are advisory; these are not.

-- ── D-007 · one active stay per room ────────────────────────────────────────
-- Rooms are reused. Two CHECKED_IN stays on one room means the guest who
-- checks into 402 on Tuesday can see the previous occupant's orders, dietary
-- notes and folio. A partial unique index makes that impossible rather than
-- unlikely — and it is what makes the concurrency test in S4 meaningful:
-- two parallel check-ins, exactly one wins, decided by Postgres.
--
-- Drizzle cannot express a WHERE clause on a unique index, so it lives here.

CREATE UNIQUE INDEX IF NOT EXISTS stays_one_active_per_room_uq
  ON "stays" ("room_id")
  WHERE "status" = 'CHECKED_IN';

-- A QR code may only have one live version at a time.
CREATE UNIQUE INDEX IF NOT EXISTS room_qr_codes_one_active_per_room_uq
  ON "room_qr_codes" ("room_id")
  WHERE "revoked_at" IS NULL;

-- One open folio per stay.
CREATE UNIQUE INDEX IF NOT EXISTS folios_one_open_per_stay_uq
  ON "folios" ("stay_id")
  WHERE "status" = 'OPEN';

-- ── #5 · money sanity ───────────────────────────────────────────────────────
-- Integer minor units are enforced by the column type. These catch the signs.
-- Deltas and adjustments are deliberately allowed to be negative; prices and
-- totals are not.

ALTER TABLE "menu_items"      ADD CONSTRAINT menu_items_price_non_negative      CHECK ("price_minor" >= 0);
ALTER TABLE "request_types"   ADD CONSTRAINT request_types_price_non_negative   CHECK ("price_minor" >= 0);
ALTER TABLE "order_items"     ADD CONSTRAINT order_items_price_non_negative     CHECK ("unit_price_minor" >= 0);
ALTER TABLE "order_items"     ADD CONSTRAINT order_items_quantity_positive      CHECK ("quantity" > 0);
ALTER TABLE "cart_items"      ADD CONSTRAINT cart_items_quantity_positive       CHECK ("quantity" > 0);
ALTER TABLE "orders"          ADD CONSTRAINT orders_totals_non_negative
  CHECK ("subtotal_minor" >= 0 AND "tax_minor" >= 0 AND "service_charge_minor" >= 0
     AND "delivery_fee_minor" >= 0 AND "tip_minor" >= 0 AND "total_minor" >= 0);
ALTER TABLE "payments"        ADD CONSTRAINT payments_amount_positive           CHECK ("amount_minor" > 0);

-- Currency is never empty, and never a bare symbol. ISO-4217 only.
ALTER TABLE "orders"      ADD CONSTRAINT orders_currency_iso      CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "folios"      ADD CONSTRAINT folios_currency_iso      CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "folio_lines" ADD CONSTRAINT folio_lines_currency_iso CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "menu_items"  ADD CONSTRAINT menu_items_currency_iso  CHECK ("currency" ~ '^[A-Z]{3}$');

-- ── §5 · folio totals cannot drift from the lines ───────────────────────────
-- The materialised totals on `folios` exist to make the guest-facing folio a
-- single cheap read. Recomputing them in application code means every new
-- write path is a chance for the header to disagree with the lines — which is
-- exactly the disagreement a guest notices at checkout.
--
-- Recomputed from the lines, in the same transaction, by the database.
-- Corrections are negative ADJUSTMENT rows, never edits.

CREATE OR REPLACE FUNCTION recompute_folio_totals() RETURNS TRIGGER AS $$
DECLARE target_folio uuid;
BEGIN
  target_folio := COALESCE(NEW."folio_id", OLD."folio_id");

  UPDATE "folios" f SET
    "charges_minor"  = COALESCE(agg.charges,  0),
    "payments_minor" = COALESCE(agg.payments, 0),
    "balance_minor"  = COALESCE(agg.charges,  0) - COALESCE(agg.payments, 0),
    "updated_at"     = now()
  FROM (
    SELECT
      SUM("amount_minor") FILTER (WHERE "source" <> 'PAYMENT') AS charges,
      SUM("amount_minor") FILTER (WHERE "source"  = 'PAYMENT') AS payments
    FROM "folio_lines" WHERE "folio_id" = target_folio
  ) agg
  WHERE f."id" = target_folio;

  RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS folio_lines_recompute ON "folio_lines";
CREATE TRIGGER folio_lines_recompute
  AFTER INSERT OR UPDATE OR DELETE ON "folio_lines"
  FOR EACH ROW EXECUTE FUNCTION recompute_folio_totals();

-- ── #6 · snapshots are not optional ─────────────────────────────────────────
-- The FK to the catalog is nullable by design (ON DELETE SET NULL, analytics
-- only). The snapshot is what renders, so it must never be empty — otherwise a
-- receipt for a deleted dish shows a blank line.

ALTER TABLE "order_items"          ADD CONSTRAINT order_items_snapshot_present          CHECK (length(btrim("name_snapshot"))  > 0);
ALTER TABLE "order_item_modifiers" ADD CONSTRAINT order_item_modifiers_snapshot_present CHECK (length(btrim("name_snapshot"))  > 0);
ALTER TABLE "service_request_items" ADD CONSTRAINT service_request_items_snapshot_present CHECK (length(btrim("label_snapshot")) > 0);

-- ── #10 · sessions bind to a stay, and store hashes only ────────────────────
-- SHA-256 hex is 64 characters. A shorter value means a raw token was stored.

ALTER TABLE "guest_sessions" ADD CONSTRAINT guest_sessions_token_is_hashed CHECK (length("token_hash") = 64);
ALTER TABLE "staff_sessions" ADD CONSTRAINT staff_sessions_token_is_hashed CHECK (length("token_hash") = 64);

-- ── §7 · SLA and routing sanity ─────────────────────────────────────────────
ALTER TABLE "request_types" ADD CONSTRAINT request_types_sla_positive CHECK ("sla_minutes" > 0);
ALTER TABLE "request_types" ADD CONSTRAINT request_types_quantity_sane
  CHECK ("max_quantity" >= 1 AND (NOT "allows_quantity" OR "max_quantity" > 1));
ALTER TABLE "service_requests" ADD CONSTRAINT service_requests_escalation_non_negative CHECK ("escalation_level" >= 0);

-- Day-of-week is 0..6, Sunday = 0.
ALTER TABLE "outlet_hours" ADD CONSTRAINT outlet_hours_dow_range CHECK ("day_of_week" BETWEEN 0 AND 6);
ALTER TABLE "menu_item_availability_windows" ADD CONSTRAINT menu_item_availability_dow_range
  CHECK ("day_of_week" IS NULL OR "day_of_week" BETWEEN 0 AND 6);

-- ── Stay lifecycle ──────────────────────────────────────────────────────────
ALTER TABLE "stays" ADD CONSTRAINT stays_checkout_after_checkin
  CHECK ("checked_out_at" IS NULL OR "checked_in_at" IS NULL OR "checked_out_at" >= "checked_in_at");
ALTER TABLE "stays" ADD CONSTRAINT stays_checked_in_has_timestamp
  CHECK ("status" <> 'CHECKED_IN' OR "checked_in_at" IS NOT NULL);
