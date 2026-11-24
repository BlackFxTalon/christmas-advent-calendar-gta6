-- Idempotent Telegram webhook processing and conservative Advisor hardening.
-- Old application tables stay inaccessible to anon/authenticated, matching their
-- existing RLS-deny behavior. No client access is opened by this migration.

BEGIN;

CREATE TABLE public.bot_update_receipts (
  update_id BIGINT PRIMARY KEY CHECK (update_id >= 0),
  actions JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(actions) = 'array'),
  processed_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  delivered_at TIMESTAMPTZ
);

ALTER TABLE public.bot_update_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.bot_update_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.bot_update_receipts TO bot_app;
GRANT INSERT (update_id) ON TABLE public.bot_update_receipts TO bot_app;
GRANT UPDATE (actions, delivered_at) ON TABLE public.bot_update_receipts TO bot_app;

CREATE POLICY bot_update_receipts_bot_app_select
  ON public.bot_update_receipts
  FOR SELECT
  TO bot_app
  USING (true);

CREATE POLICY bot_update_receipts_bot_app_insert
  ON public.bot_update_receipts
  FOR INSERT
  TO bot_app
  WITH CHECK (true);

CREATE POLICY bot_update_receipts_bot_app_update
  ON public.bot_update_receipts
  FOR UPDATE
  TO bot_app
  USING (true)
  WITH CHECK (true);

CREATE POLICY bot_update_receipts_deny_api_roles
  ON public.bot_update_receipts
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$function$;

-- Explicitly preserve the current default-deny behavior of these legacy tables.
CREATE POLICY board_games_deny_api_roles
  ON public.board_games
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY recommendation_sessions_deny_api_roles
  ON public.recommendation_sessions
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY user_feedback_deny_api_roles
  ON public.user_feedback
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

COMMIT;
