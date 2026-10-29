-- 0013_property_guest_info.sql — D-087: what a guest asks the front desk
--
-- "What's the wifi?", "what time do I have to leave?", "can I WhatsApp you?"
-- are the questions a front desk answers forty times a day, and the guest app
-- could answer none of them: the property row held a name, a clock, a
-- currency and half an address. These are the hotel's own facts, edited on
-- the console's Property screen and read by the guest's Stay screen.
--
--   contact_phone      E.164-ish, digits and a leading +. Rendered as tel:.
--   contact_whatsapp   the same, for wa.me. Often the same number; not
--                      assumed to be.
--   contact_email      shown, never mailed by us (there is no mail provider).
--   check_in_time      'HH:MM', property-local. The hotel's STANDARD time —
--   check_out_time     a stay's own scheduled checkout still wins for that
--                      stay; these are what a guest is told before they ask.
--   wifi_network       the SSID.
--   wifi_password      shown to a guest holding a room session, never on a
--                      property link (a table tent is a public surface).
--
-- All nullable: a hotel that has not filled one in shows nothing rather than
-- a placeholder, and a guest is never told "Wi-Fi: not set".
--
-- Branding needs no column. `properties.branding` has been a jsonb since 0000
-- (D-016) and nothing wrote it; D-087 gives it a shape (accent, logo, cover),
-- validated in the identity module, not by the database.
--
-- And one index. The Staff screen now shows what each person did recently,
-- which is event_log by actor — a question the existing (entity) and
-- (property, time) indexes cannot answer without a scan of the property's
-- whole history.

ALTER TABLE "properties" ADD COLUMN "contact_phone" text;
--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "contact_whatsapp" text;
--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "contact_email" text;
--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "check_in_time" text;
--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "check_out_time" text;
--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "wifi_network" text;
--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "wifi_password" text;
--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_check_in_time_hhmm"
  CHECK ("check_in_time" IS NULL OR "check_in_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_check_out_time_hhmm"
  CHECK ("check_out_time" IS NULL OR "check_out_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_log_actor_staff_idx"
  ON "event_log" ("actor_staff_id", "occurred_at")
  WHERE "actor_staff_id" IS NOT NULL;
