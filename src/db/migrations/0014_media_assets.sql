-- 0014_media_assets.sql — D-093: pictures are uploaded, not pasted
--
-- Until now every picture in the console was a pasted URL: a dish's photo,
-- the logo, the cover. This is the record of an UPLOADED picture. The bytes
-- live in object storage at `media/<id>/<width>.webp` (a Railway bucket in
-- production); this row says who uploaded it, for what, and what was stored.
--
-- No column elsewhere changes. A dish keeps `image_url` and the upload writes
-- the picture's path into it — `/media/<id>/1280.webp`, relative, so it
-- survives a change of domain or storage, and an order line's
-- `image_url_snapshot` copies it like any other (#6). Pasted URLs and the
-- seeded photographs keep working untouched.
--
-- Additive: a new table that code from before this migration never reads.

CREATE TABLE "media_assets" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"            uuid NOT NULL,
  "property_id"          uuid NOT NULL,
  "purpose"              text NOT NULL,
  "width"                integer NOT NULL,
  "height"               integer NOT NULL,
  "widths"               integer[] NOT NULL,
  "blurhash"             text,
  "bytes"                integer NOT NULL,
  "uploaded_by_staff_id" uuid REFERENCES "staff_users"("id"),
  "created_at"           timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX "media_assets_property_idx" ON "media_assets" ("property_id", "created_at");
--> statement-breakpoint

ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_purpose_known" CHECK (
  "purpose" IN ('dish', 'logo', 'cover')
);
--> statement-breakpoint

ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_sizes_positive" CHECK (
  "width" > 0 AND "height" > 0 AND "bytes" > 0 AND cardinality("widths") >= 1
);
--> statement-breakpoint

ALTER TABLE "media_assets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "media_assets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "media_assets";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "media_assets"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
-- No UPDATE: an upload is written once. A replaced picture is a new upload.
GRANT SELECT, INSERT, DELETE ON "media_assets" TO app_user;
