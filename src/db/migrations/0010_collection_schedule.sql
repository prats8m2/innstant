-- 0010_collection_schedule.sql — D-084: menus on a schedule
--
-- A collection ("After 10pm", "Chef Bhairav's table") could already be held
-- to a time of day: available_from / available_until. It could not be held
-- to days of the week ("Weekend brunch") or to dates ("Diwali, 1–5
-- November", "Today's special"), so either somebody remembered to switch it
-- off, or the guest saw Sunday's thali on a Tuesday.
--
--   days_of_week   0 = Sunday … 6 = Saturday, the convention outlet_hours
--                  and menu_item_availability_windows already use. NULL means
--                  every day; an empty array is refused rather than meaning
--                  "never", because "never" is is_active = false and two
--                  spellings of one state is how one of them gets missed.
--   starts_on      Property-local calendar dates, inclusive. Either may be
--   ends_on        NULL for an open end. `date`, not `timestamptz`: "the 5th"
--                  at a hotel in Udaipur is the 5th in Udaipur, and there is
--                  no instant to store (CLAUDE.md "Dates").
--
-- A window that runs past midnight belongs to the day it STARTED: Friday
-- 22:00–01:00 is still Friday's at 00:30 on Saturday. That rule lives in
-- one tested function, isCollectionLive() in modules/catalog/hours.ts.
--
-- ─── Everything here is additive ───────────────────────────────────────────
--
-- Three nullable columns and two CHECKs that every existing row satisfies
-- (all three NULL). Code from before this migration never reads or writes
-- them, and every collection it created is "every day, no end", which is
-- what it meant.

ALTER TABLE "collections" ADD COLUMN "days_of_week" smallint[];
--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "starts_on" date;
--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "ends_on" date;
--> statement-breakpoint

ALTER TABLE "collections" ADD CONSTRAINT "collections_days_of_week_valid" CHECK (
  "days_of_week" IS NULL
  OR (
    cardinality("days_of_week") BETWEEN 1 AND 7
    AND "days_of_week" <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::smallint[]
  )
);
--> statement-breakpoint

ALTER TABLE "collections" ADD CONSTRAINT "collections_dates_ordered" CHECK (
  "starts_on" IS NULL OR "ends_on" IS NULL OR "ends_on" >= "starts_on"
);
