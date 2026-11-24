const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;

function normalizePlayerId(value) {
  const playerId = String(value ?? "");
  if (!/^[1-9]\d{0,18}$/u.test(playerId) || BigInt(playerId) > MAX_POSTGRES_BIGINT) {
    throw new TypeError("Telegram user ID must be a positive integer within PostgreSQL BIGINT range.");
  }
  return playerId;
}

function normalizeUpdateId(value) {
  const updateId = typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : String(value ?? "");
  if (!/^(0|[1-9]\d{0,18})$/u.test(updateId) || BigInt(updateId) > MAX_POSTGRES_BIGINT) {
    throw new TypeError("Telegram update_id must be a non-negative integer within PostgreSQL BIGINT range.");
  }
  return updateId;
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

  let pool = suppliedPool ?? null;
  let poolPromise = null;

  async function getPool() {
    if (pool) return pool;
    poolPromise ??= import("pg").then(({ default: pg }) => {
      pool = new pg.Pool({
        connectionString,
        max: 5,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
      });
      return pool;
    });
    return poolPromise;
  }

  async function ensurePlayer(playerId) {
    const id = normalizePlayerId(playerId);
    const db = await getPool();
    await db.query(
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
      const db = await getPool();
      const result = await db.query(
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
      const db = await getPool();
      const result = await db.query(
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
      const db = await getPool();
      const result = await db.query(
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
      const db = await getPool();
      const result = await db.query(
        `SELECT case_id, status, attempts_count, hints_used, started_at, completed_at
         FROM bot_case_progress
         WHERE telegram_user_id = $1
         ORDER BY case_id`,
        [id],
      );
      return result.rows;
    },

    // Evidence views are optional until migration 005 is applied: a missing
    // table must not break /archive, it only hides the "новое" marker.
    async markViewed(playerId, caseId, evidenceId) {
      const id = normalizePlayerId(playerId);
      const normalizedCaseId = normalizeCaseId(caseId);
      const normalizedEvidenceId = String(evidenceId ?? "");
      if (!/^[a-z0-9-]{1,24}$/u.test(normalizedEvidenceId)) {
        throw new TypeError("Evidence ID must match ^[a-z0-9-]{1,24}$.");
      }
      const db = await getPool();
      try {
        await db.query(
          `INSERT INTO public.bot_evidence_views (telegram_user_id, case_id, evidence_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (telegram_user_id, case_id, evidence_id) DO NOTHING`,
          [id, normalizedCaseId, normalizedEvidenceId],
        );
        return true;
      } catch (error) {
        if (error?.code === "42P01") return false;
        throw error;
      }
    },

    async getViewed(playerId) {
      const id = normalizePlayerId(playerId);
      const db = await getPool();
      try {
        const result = await db.query(
          `SELECT case_id, evidence_id
           FROM public.bot_evidence_views
           WHERE telegram_user_id = $1`,
          [id],
        );
        return new Set(result.rows.map((row) => `${row.case_id}:${row.evidence_id}`));
      } catch (error) {
        if (error?.code === "42P01") return new Set();
        throw error;
      }
    },

    async processUpdate(updateId, handler) {
      const id = normalizeUpdateId(updateId);
      if (typeof handler !== "function") throw new TypeError("An update handler is required.");
      const db = await getPool();
      if (typeof db.connect !== "function") throw new Error("The PostgreSQL pool must support transactions.");

      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const inserted = await client.query(
          `INSERT INTO public.bot_update_receipts (update_id)
           VALUES ($1)
           ON CONFLICT (update_id) DO NOTHING
           RETURNING update_id`,
          [id],
        );

        if (inserted.rows.length === 0) {
          const existing = await client.query(
            `SELECT actions, delivered_at
             FROM public.bot_update_receipts
             WHERE update_id = $1`,
            [id],
          );
          if (!existing.rows[0]) throw new Error("The duplicate update receipt was not visible.");
          await client.query("COMMIT");
          const receipt = existing.rows[0];
          const actions = receipt.delivered_at || !Array.isArray(receipt.actions)
            ? []
            : receipt.actions.filter((action) => action?.type !== "callbackAck");
          return { duplicate: true, actions };
        }

        const transactionStore = createPostgresProgressStore({ pool: client });
        const actions = await handler(transactionStore);
        if (!Array.isArray(actions)) throw new TypeError("The update handler must return an action array.");
        const replayableActions = actions.filter((action) => action?.type !== "callbackAck");
        await client.query(
          `UPDATE public.bot_update_receipts
           SET actions = $2::jsonb
           WHERE update_id = $1`,
          [id, JSON.stringify(replayableActions)],
        );
        await client.query("COMMIT");
        return { duplicate: false, actions };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async markUpdateDelivered(updateId) {
      const id = normalizeUpdateId(updateId);
      const db = await getPool();
      const result = await db.query(
        `UPDATE public.bot_update_receipts
         SET delivered_at = COALESCE(delivered_at, NOW()),
             actions = '[]'::jsonb
         WHERE update_id = $1`,
        [id],
      );
      return result.rowCount > 0;
    },

    async close() {
      if (!suppliedPool && poolPromise) {
        const db = await poolPromise;
        await db.end();
      }
    },
  };
}
