-- Server-only access for the Telegram bot's progress tables.
-- Do not expose these tables to browser/API roles: Telegram user IDs are not Supabase Auth IDs.
-- A direct PostgreSQL connection must use trusted backend credentials. If using a non-owner,
-- non-BYPASSRLS database role, add an explicit GRANT and a role-specific permissive policy
-- for that role before applying this migration.

BEGIN;

ALTER TABLE public.bot_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_case_progress ENABLE ROW LEVEL SECURITY;

-- Supabase projects may grant broad table privileges to these API roles by default.
REVOKE ALL PRIVILEGES ON TABLE public.bot_players FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.bot_case_progress FROM PUBLIC, anon, authenticated;

-- Restrictive deny policies keep the API roles blocked even if a permissive policy is added later.
CREATE POLICY bot_players_deny_api_roles
  ON public.bot_players
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY bot_case_progress_deny_api_roles
  ON public.bot_case_progress
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

COMMIT;
