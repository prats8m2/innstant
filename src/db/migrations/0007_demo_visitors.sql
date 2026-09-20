-- 0007_demo_visitors.sql — who pressed "See how it works" on the website
--
-- The marketing site's demo link asks a visitor their first name, shows it back
-- to them on the guest screen, and keeps a row here. That is the whole feature.
--
-- ─── The one table in this database with no tenant_id ───────────────────────
--
-- Deliberate. Every other table belongs to a hotel; this one belongs to US.
-- Somebody trying the demo has no tenant, no property and no stay — they are a
-- stranger on a marketing page. Stamping these rows with an invented "platform"
-- tenant so that `withTenant()` could be used unchanged would satisfy the letter
-- of CLAUDE.md #1 and lose its point, and every future query would have had to
-- know which of the two kinds of row it was looking at.
--
-- ─── So what protects it ────────────────────────────────────────────────────
--
-- Not tenant isolation — there is nothing to isolate it from. The asymmetry this
-- table needs is one the tenant rule has no way to say: the app may WRITE here
-- and must never READ. That is enforced below, in Postgres, rather than by
-- remembering to be careful in application code.
--
-- RLS is enabled AND forced, and there is exactly one policy: INSERT. With
-- forced RLS and no SELECT policy, `app_user` reading this table gets zero rows
-- — not an error it might catch and work around, just nothing. Reading the list
-- is a psql job for whoever owns the database.
--
-- Hand-written and numbered to sit after 0006. `db:migrate` applies files in
-- filename order and tracks them by filename.

CREATE TABLE "demo_visitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	-- What they were shown, so a row is still meaningful if the demo property is
	-- reseeded and the room number means something else.
	"room_number" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "demo_visitors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "demo_visitors" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Write, and only write. There is no SELECT, UPDATE or DELETE policy on
-- purpose; see the note above.
CREATE POLICY "demo_visitors_insert_only" ON "demo_visitors"
  FOR INSERT TO app_user WITH CHECK (true);--> statement-breakpoint

-- Newest first is the only way anybody will ever read this.
CREATE INDEX "demo_visitors_created_idx" ON "demo_visitors" ("created_at" DESC);
