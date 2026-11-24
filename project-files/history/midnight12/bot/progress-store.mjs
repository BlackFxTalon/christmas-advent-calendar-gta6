import pg from "pg";

const { Pool } = pg;
const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;

function normalizePlayerId(value) {
  const playerId = String(value ?? "");
  if (!/^[1-9]\d{0,18}$/u.test(playerId) || BigInt(playerId) > MAX_POSTGRES_BIGINT) {
    throw new TypeError("Telegram user ID must be a positive integer within PostgreSQL BIGINT range.");
  }
  return playerId;
}

function normalizeCaseId(value) {
  const caseId = Number(value);
  if (!Number.isInteger(caseId) || caseId < 1 || caseId > 12) {
    throw new RangeError("Case ID must be an integer between 1 and 12.");
  }
  return caseId;
}

const RETURNING_PROGRESS = `
  RETURNING case_id, status, attempts_count, hints_used, started_at, completed_at
`;

export function createPostgresProgressStore({
  connectionString = process.env.DATABASE_URL,
  pool: suppliedPool,
} = {}) {
  if (!suppliedPool && !connectionString) {
    throw new Error("Set DATABASE_URL in the server environment.");
  }

  const pool = suppliedPool ?? new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  async function ensurePlayer(playerId) {
    const id = normalizePlayerId(playerId);
    await pool.query(
      `INSERT INTO bot_players (telegram_user_id)
       VALUES ($1)
       ON CONFLICT (telegram_user_id)
       DO UPDATE SET updated_at = NOW()`,
      [id],
    );
    return id;
  }

  return {
    async markCaseIssued(playerId, caseId) {
      const id = await ensurePlayer(playerId);
      const normalizedCaseId = normalizeCaseId(caseId);
      const result = await pool.query(
        `INSERT INTO bot_case_progress
           (telegram_user_id, case_id, status, attempts_count, hints_used, started_at, updated_at)
         VALUES ($1, $2, 'in_progress', 0, 0, NOW(), NOW())
         ON CONFLICT (telegram_user_id, case_id)
         DO UPDATE SET
           status = CASE
             WHEN bot_case_progress.status = 'completed' THEN 'completed'
             ELSE 'in_progress'
           END,
           started_at = COALESCE(bot_case_progress.started_at, NOW()),
           updated_at = NOW()
         ${RETURNING_PROGRESS}`,
        [id, normalizedCaseId],
      );
      return result.rows[0] ?? null;
    },

    async recordHint(playerId, caseId, step) {
      const id = await ensurePlayer(playerId);
      const normalizedCaseId = normalizeCaseId(caseId);
      const hintStep = Number(step);
      if (!Number.isInteger(hintStep) || hintStep < 1 || hintStep > 3) {
        throw new RangeError("Hint step must be an integer between 1 and 3.");
      }
      const result = await pool.query(
        `INSERT INTO bot_case_progress
           (telegram_user_id, case_id, status, attempts_count, hints_used, started_at, updated_at)
         VALUES ($1, $2, 'in_progress', 0, $3, NOW(), NOW())
         ON CONFLICT (telegram_user_id, case_id)
         DO UPDATE SET
           status = CASE
             WHEN bot_case_progress.status = 'completed' THEN 'completed'
             ELSE 'in_progress'
           END,
           hints_used = GREATEST(bot_case_progress.hints_used, EXCLUDED.hints_used),
           started_at = COALESCE(bot_case_progress.started_at, NOW()),
           updated_at = NOW()
         ${RETURNING_PROGRESS}`,
        [id, normalizedCaseId, hintStep],
      );
      return result.rows[0] ?? null;
    },

    async recordAttempt(playerId, caseId, isCorrect) {
      const id = await ensurePlayer(playerId);
      const normalizedCaseId = normalizeCaseId(caseId);
      const correct = Boolean(isCorrect);
      const result = await pool.query(
        `INSERT INTO bot_case_progress
           (telegram_user_id, case_id, status, attempts_count, hints_used, started_at, completed_at, updated_at)
         VALUES (
           $1, $2,
           CASE WHEN $3 THEN 'completed' ELSE 'in_progress' END,
           1, 0, NOW(), CASE WHEN $3 THEN NOW() ELSE NULL END, NOW()
         )
         ON CONFLICT (telegram_user_id, case_id)
         DO UPDATE SET
           attempts_count = bot_case_progress.attempts_count + 1,
           status = CASE
             WHEN bot_case_progress.status = 'completed' OR EXCLUDED.status = 'completed' THEN 'completed'
             ELSE 'in_progress'
           END,
           completed_at = CASE
             WHEN EXCLUDED.status = 'completed' THEN COALESCE(bot_case_progress.completed_at, NOW())
             ELSE bot_case_progress.completed_at
           END,
           started_at = COALESCE(bot_case_progress.started_at, NOW()),
           updated_at = NOW()
         ${RETURNING_PROGRESS}`,
        [id, normalizedCaseId, correct],
      );
      return result.rows[0] ?? null;
    },

    async getProgress(playerId) {
      const id = normalizePlayerId(playerId);
      const result = await pool.query(
        `SELECT case_id, status, attempts_count, hints_used, started_at, completed_at
         FROM bot_case_progress
         WHERE telegram_user_id = $1
         ORDER BY case_id`,
        [id],
      );
      return result.rows;
    },

    async close() {
      if (!suppliedPool) await pool.end();
    },
  };
}
