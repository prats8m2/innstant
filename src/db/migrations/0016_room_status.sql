-- 0016_room_status.sql — D-096: is the room ready for the next guest?
--
-- Occupancy says whether somebody is IN a room. It does not say whether an
-- empty room can be sold: a room a guest left an hour ago is empty and dirty,
-- and a desk that checks the next guest into it has made a complaint. This is
-- the housekeeping half of a room's state:
--
--   CLEAN         made up, ready
--   DIRTY         needs making up — set at checkout, in the same transaction
--   INSPECTED     a supervisor has checked it: the best a room can be
--   OUT_OF_ORDER  temporarily unsellable (a leak, a broken AC), with a note;
--                 not the same as a room taken out of service at setup
--
-- One row per room, written on change; a room with no row is CLEAN — every
-- room on a fresh property is. Owned by the housekeeping module (rooms belong
-- to identity, D-001); every change writes an event (#7).

CREATE TYPE "room_clean_status" AS ENUM ('CLEAN', 'DIRTY', 'INSPECTED', 'OUT_OF_ORDER');
--> statement-breakpoint

CREATE TABLE "room_status" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"           uuid NOT NULL,
  "property_id"         uuid NOT NULL,
  "room_id"             uuid NOT NULL REFERENCES "rooms"("id") ON DELETE CASCADE,
  "status"              "room_clean_status" NOT NULL DEFAULT 'CLEAN',
  "note"                text,
  "updated_by_staff_id" uuid REFERENCES "staff_users"("id"),
  "created_at"          timestamptz DEFAULT now() NOT NULL,
  "updated_at"          timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX "room_status_room_uq" ON "room_status" ("room_id");
--> statement-breakpoint
CREATE INDEX "room_status_property_idx" ON "room_status" ("property_id", "status");
--> statement-breakpoint

-- Out of order says why; nothing else needs to.
ALTER TABLE "room_status" ADD CONSTRAINT "room_status_ooo_note" CHECK (
  "status" <> 'OUT_OF_ORDER' OR ("note" IS NOT NULL AND length(trim("note")) > 0)
);
--> statement-breakpoint

ALTER TABLE "room_status" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "room_status" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "room_status";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "room_status"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "room_status" TO app_user;
