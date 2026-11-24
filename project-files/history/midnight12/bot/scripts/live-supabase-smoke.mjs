import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { handleUpdate } from "../engine.mjs";
import { createPostgresProgressStore } from "../progress-store.mjs";

const { Pool } = pg;
const projectRef = "ldwlwguvyutewcoyjxnn";
const rawConnectionString = process.env.DATABASE_URL;

function fail(code) {
  console.error(`LIVE_TEST_FAILED: ${code}`);
  process.exitCode = 1;
}

function randomTestId() {
  const suffix = BigInt(`0x${randomBytes(4).toString("hex")}`);
  return String(9_000_000_000_000_000_000n + suffix);
}

if (!rawConnectionString) {
  fail("DATABASE_URL_MISSING");
} else {
  let parsedUrl;
  try {
    parsedUrl = new URL(rawConnectionString);
  } catch {
    fail("DATABASE_URL_INVALID");
  }

  if (parsedUrl) {
    const username = decodeURIComponent(parsedUrl.username);
    const isExpectedProject =
      parsedUrl.hostname.toLowerCase() === `db.${projectRef}.supabase.co` ||
      username.includes(projectRef);

    if (!isExpectedProject) {
      fail("WRONG_SUPABASE_PROJECT");
    } else if (!["require", "verify-ca", "verify-full"].includes(parsedUrl.searchParams.get("sslmode"))) {
      fail("SSL_MODE_REQUIRED_ADD_SSLMODE_REQUIRE");
    } else {
      await runLiveTest();
    }
  }
}

async function runLiveTest() {
  const pool = new Pool({
    connectionString: rawConnectionString,
    max: 1,
    connectionTimeoutMillis: 5_000,
  });
  let client;
  let store;
  let transactionOpen = false;

  try {
    client = await pool.connect();
    const connection = await client.query(`
      SELECT current_database() AS database_name,
             COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS ssl_enabled
    `);
    assert.equal(connection.rows[0]?.database_name, "postgres");
    assert.equal(connection.rows[0]?.ssl_enabled, true, "PostgreSQL connection must use SSL");

    const tables = await client.query(`
      SELECT count(*)::int AS found
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('bot_players', 'bot_case_progress')
    `);
    assert.equal(tables.rows[0]?.found, 2, "Expected bot progress tables are missing");

    let testId;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = randomTestId();
      const existing = await client.query(
        "SELECT 1 FROM public.bot_players WHERE telegram_user_id = $1 LIMIT 1",
        [candidate],
      );
      if (existing.rowCount === 0) {
        testId = candidate;
        break;
      }
    }
    assert.ok(testId, "Could not allocate a unique temporary test ID");

    await client.query("BEGIN");
    transactionOpen = true;
    store = createPostgresProgressStore({ pool: client });

    const update = (text, extras = {}) => ({
      message: {
        chat: { id: 100, type: "private" },
        from: { id: testId },
        text,
        ...extras,
      },
    });

    const issued = await handleUpdate(update("/case 1"), {
      previewMode: true,
      progressStore: store,
    });
    const caseMessage = issued.find((action) => action.type === "message");
    assert.ok(caseMessage?.text.includes("ДЕЛО № 01"), "Bot did not issue case 1");

    const hint = await handleUpdate(update("/hint 1 2"), { progressStore: store });
    assert.ok(hint[0]?.text.includes("Подсказка 2 из 3"), "Bot did not return hint 2");

    await handleUpdate(update("неверный тестовый ответ", {
      reply_to_message: { text: caseMessage.text },
    }), { progressStore: store });
    await handleUpdate(update("23:30:55", {
      reply_to_message: { text: caseMessage.text },
    }), { progressStore: store });

    const [progressReply] = await handleUpdate(update("/progress"), { progressStore: store });
    assert.match(progressReply.text, /Решено: 1 из 3\./u);
    assert.match(progressReply.text, /Пять минут тишины — решено; попыток: 2; подсказок: 2/u);

    const rows = await store.getProgress(testId);
    const caseRow = rows.find((row) => Number(row.case_id) === 1);
    assert.equal(caseRow?.status, "completed");
    assert.equal(Number(caseRow?.attempts_count), 2);
    assert.equal(Number(caseRow?.hints_used), 2);
    assert.ok(caseRow?.completed_at, "Completion timestamp was not persisted");

    await client.query("ROLLBACK");
    transactionOpen = false;
    console.log("LIVE_TEST_PASS: SSL connection, bot tables, case/hint/attempt/progress flow; test transaction rolled back.");
  } catch (error) {
    fail(error?.code ?? error?.name ?? "UNKNOWN_ERROR");
    if (transactionOpen && client) {
      await client.query("ROLLBACK").catch(() => {});
      transactionOpen = false;
    }
  } finally {
    if (store) await store.close().catch(() => {});
    client?.release();
    await pool.end().catch(() => {});
  }
}
