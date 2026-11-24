-- ЧЕРНОВИК. Не перемещать в bot/migrations до подключения архива к движку.
-- Предлагаемый номер: 005_evidence_views.sql. Применять после 001–004.
-- Хранит только факт просмотра улики. Статус дела по-прежнему живёт в bot_case_progress.

BEGIN;

CREATE TABLE IF NOT EXISTS public.bot_evidence_views (
  telegram_user_id BIGINT NOT NULL,
  case_id SMALLINT NOT NULL CHECK (case_id BETWEEN 1 AND 12),
  evidence_id TEXT NOT NULL CHECK (evidence_id ~ '^[a-z0-9-]{1,24}$'),
  first_viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (telegram_user_id, case_id, evidence_id),
  -- Улику можно просмотреть только в выданном деле.
  FOREIGN KEY (telegram_user_id, case_id)
    REFERENCES public.bot_case_progress (telegram_user_id, case_id) ON DELETE CASCADE
);

ALTER TABLE public.bot_evidence_views ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.bot_evidence_views FROM PUBLIC, anon, authenticated;

CREATE POLICY bot_evidence_views_deny_api_roles
  ON public.bot_evidence_views AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- bot_app: только чтение и вставка; UPDATE/DELETE не нужны.
GRANT SELECT ON TABLE public.bot_evidence_views TO bot_app;
GRANT INSERT (telegram_user_id, case_id, evidence_id) ON TABLE public.bot_evidence_views TO bot_app;

CREATE POLICY bot_evidence_views_bot_app_select
  ON public.bot_evidence_views FOR SELECT TO bot_app USING (true);
CREATE POLICY bot_evidence_views_bot_app_insert
  ON public.bot_evidence_views FOR INSERT TO bot_app WITH CHECK (true);

COMMIT;

-- Запросы для progress-store.mjs:
--   markViewed:  INSERT INTO bot_evidence_views (telegram_user_id, case_id, evidence_id)
--                VALUES ($1, $2, $3) ON CONFLICT DO NOTHING;
--   getViewed:   SELECT case_id, evidence_id FROM bot_evidence_views WHERE telegram_user_id = $1;
