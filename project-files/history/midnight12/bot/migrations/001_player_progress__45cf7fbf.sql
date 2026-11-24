CREATE TABLE IF NOT EXISTS bot_players (
  telegram_user_id BIGINT PRIMARY KEY CHECK (telegram_user_id > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bot_case_progress (
  telegram_user_id BIGINT NOT NULL REFERENCES bot_players (telegram_user_id) ON DELETE CASCADE,
  case_id SMALLINT NOT NULL CHECK (case_id BETWEEN 1 AND 12),
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  attempts_count INTEGER NOT NULL DEFAULT 0 CHECK (attempts_count >= 0),
  hints_used SMALLINT NOT NULL DEFAULT 0 CHECK (hints_used BETWEEN 0 AND 3),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (telegram_user_id, case_id),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS bot_case_progress_status_idx
  ON bot_case_progress (status, updated_at DESC);
