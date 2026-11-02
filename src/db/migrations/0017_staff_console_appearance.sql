-- 0017_staff_console_appearance.sql — the console's light or dark, per person.
--
-- The console has a light and a dark look (design/tokens/innstant-themes.css,
-- D-100), and which one is right depends on the person, not the property: the
-- night manager in a dim back office and the day desk by a window read the
-- same screen. So it is a column on the account, set from the moon in the
-- console's top bar, and it follows them to any machine they sign in on.
--
--   light    always light
--   dark     always dark
--   system   whatever the device says (prefers-color-scheme), resolved in the
--            browser; the default, so nobody's console changes until they ask
--
-- A preference, not a status: no event is written for a change (#7 covers
-- status changes). staff_users already has RLS from 0001; app_user already
-- holds UPDATE on it (the sign-in stamps last_login_at).

ALTER TABLE "staff_users"
  ADD COLUMN "console_appearance" text NOT NULL DEFAULT 'system';
--> statement-breakpoint

ALTER TABLE "staff_users" ADD CONSTRAINT "staff_users_console_appearance_chk" CHECK (
  "console_appearance" IN ('light', 'dark', 'system')
);
