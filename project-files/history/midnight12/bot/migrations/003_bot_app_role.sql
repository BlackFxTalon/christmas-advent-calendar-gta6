-- Run only after 002_bot_rls.sql has been applied.
-- Creates a non-login role first; set its password securely with psql \password,
-- then enable LOGIN as described in the README. Never store the password here.
-- The bot is a trusted server process and can access all progress rows, but cannot DELETE or run DDL.

BEGIN;

CREATE ROLE bot_app
  NOLOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOREPLICATION
  NOBYPASSRLS;

GRANT USAGE ON SCHEMA public TO bot_app;

-- Read access is needed for progress reads, ON CONFLICT checks, and RETURNING clauses.
GRANT SELECT ON TABLE public.bot_players, public.bot_case_progress TO bot_app;

-- Match the columns used by progress-store.mjs; do not grant UPDATE on identity keys.
GRANT INSERT (telegram_user_id) ON TABLE public.bot_players TO bot_app;
GRANT UPDATE (updated_at) ON TABLE public.bot_players TO bot_app;

GRANT INSERT (
  telegram_user_id,
  case_id,
  status,
  attempts_count,
  hints_used,
  started_at,
  completed_at,
  updated_at
) ON TABLE public.bot_case_progress TO bot_app;

GRANT UPDATE (
  status,
  attempts_count,
  hints_used,
  started_at,
  completed_at,
  updated_at
) ON TABLE public.bot_case_progress TO bot_app;

CREATE POLICY bot_players_bot_app_select
  ON public.bot_players
  FOR SELECT
  TO bot_app
  USING (true);

CREATE POLICY bot_players_bot_app_insert
  ON public.bot_players
  FOR INSERT
  TO bot_app
  WITH CHECK (true);

CREATE POLICY bot_players_bot_app_update
  ON public.bot_players
  FOR UPDATE
  TO bot_app
  USING (true)
  WITH CHECK (true);

CREATE POLICY bot_case_progress_bot_app_select
  ON public.bot_case_progress
  FOR SELECT
  TO bot_app
  USING (true);

CREATE POLICY bot_case_progress_bot_app_insert
  ON public.bot_case_progress
  FOR INSERT
  TO bot_app
  WITH CHECK (true);

CREATE POLICY bot_case_progress_bot_app_update
  ON public.bot_case_progress
  FOR UPDATE
  TO bot_app
  USING (true)
  WITH CHECK (true);

COMMIT;
