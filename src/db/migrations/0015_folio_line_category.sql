-- 0015_folio_line_category.sql — D-095: what a desk-added charge IS
--
-- The checkout screen shows a bill grouped the way a guest reads one: room,
-- food and drink, amenities, late checkout, other charges, taxes, discounts.
-- Every line's group follows from its `source` except the desk's own:
-- MANUAL is a room night, a minibar, a laundry bag, a broken glass, or the
-- GST on one of those, and nothing on the row said which.
--
-- `category` says which, for MANUAL lines. Null everywhere else — the source
-- already answers. Room charges are typed in by the desk ("Room · 3 nights ×
-- ₹6,500"); nothing about a price is stored on a room (#11), and the rate
-- tables stay reserved (#12).
--
-- A TAX line points at the charge it is tax on through `source_ref_id`, so
-- the bill can print "GST 12% on Room · 3 nights" under it.
--
-- Additive: a nullable column that code from before this migration never
-- reads or writes.

ALTER TABLE "folio_lines" ADD COLUMN "category" text;
--> statement-breakpoint

ALTER TABLE "folio_lines" ADD CONSTRAINT "folio_lines_category_known" CHECK (
  "category" IS NULL
  OR "category" IN ('ROOM', 'MINIBAR', 'LAUNDRY', 'DAMAGE', 'OTHER', 'TAX')
);
--> statement-breakpoint

-- Only the desk's lines carry one.
ALTER TABLE "folio_lines" ADD CONSTRAINT "folio_lines_category_manual_only" CHECK (
  "category" IS NULL OR "source" = 'MANUAL'
);
