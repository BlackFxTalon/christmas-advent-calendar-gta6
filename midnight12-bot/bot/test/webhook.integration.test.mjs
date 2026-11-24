import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createBotServer } from "../server.mjs";
import { createPostgresProgressStore } from "../progress-store.mjs";

// In-memory PostgreSQL stand-in: receipts, players and case progress share
// one transactional snapshot, so ROLLBACK can be asserted end-to-end.
function createIntegrationPool() {
  const state = {
    receipts: new Map(),
    players: new Set(),
    progress: new Map(),
    views: new Set(),
  };
  let snapshot = null;
  let failNextProgressInsert = false;

  const cloneState = () => ({
    receipts: new Map([...state.receipts].map(([key, value]) => [key, structuredClone(value)])),
    players: new Set(state.players),
    progress: new Map([...state.progress].map(([key, value]) => [key, structuredClone(value)])),
    views: new Set(state.views),
  });
  const progressKey = (playerId, caseId) => `${playerId}:${caseId}`;
  const rowFor = (playerId, caseId) => state.progress.get(progressKey(playerId, caseId)) ?? null;

  function applyIssued(playerId, caseId) {
    const key = progressKey(playerId, caseId);
    let row = state.progress.get(key);
    if (!row) {
      row = {
        case_id: Number(caseId),
        status: "in_progress",
        attempts_count: 0,
        hints_used: 0,
        started_at: "2026-12-20T09:00:00.000Z",
        completed_at: null,
      };
      state.progress.set(key, row);
    } else if (row.status !== "completed") {
      row.status = "in_progress";
    }
    return { ...row };
  }

  async function query(sql, values = []) {
    const statement = String(sql).replace(/\s+/gu, " ").trim();

    if (statement === "BEGIN") {
      snapshot = cloneState();
      return { rows: [] };
    }
    if (statement === "COMMIT") {
      snapshot = null;
      return { rows: [] };
    }
    if (statement === "ROLLBACK") {
      if (snapshot) {
        state.receipts = snapshot.receipts;
        state.players = snapshot.players;
        state.progress = snapshot.progress;
        state.views = snapshot.views;
      }
      snapshot = null;
      return { rows: [] };
    }

    if (statement.startsWith("INSERT INTO bot_players")) {
      state.players.add(String(values[0]));
      return { rows: [] };
    }

    if (statement.startsWith("INSERT INTO bot_case_progress")) {
      if (failNextProgressInsert) {
        failNextProgressInsert = false;
        throw new Error("simulated PostgreSQL failure");
      }
      const [playerId, caseId] = values;
      if (statement.includes("CASE WHEN $3 THEN 'completed'")) {
        const key = progressKey(playerId, caseId);
        const existing = state.progress.get(key);
        const correct = Boolean(values[2]);
        const row = existing ?? {
          case_id: Number(caseId),
          status: "in_progress",
          attempts_count: 0,
          hints_used: 0,
          started_at: "2026-12-20T09:00:00.000Z",
          completed_at: null,
        };
        row.attempts_count += 1;
        if (correct) {
          row.status = "completed";
          row.completed_at ??= "2026-12-20T09:05:00.000Z";
        }
        state.progress.set(key, row);
        return { rows: [{ ...row }] };
      }
      if (statement.includes("VALUES ($1, $2, 'in_progress', 0, $3")) {
        const row = applyIssued(playerId, caseId);
        row.hints_used = Math.max(row.hints_used, Number(values[2]));
        state.progress.set(progressKey(playerId, caseId), row);
        return { rows: [{ ...row }] };
      }
      return { rows: [applyIssued(playerId, caseId)] };
    }

    if (statement.startsWith("SELECT case_id, status, attempts_count, hints_used")) {
      const rows = [...state.progress.entries()]
        .filter(([key]) => key.startsWith(`${values[0]}:`))
        .map(([, row]) => ({ ...row }))
        .sort((a, b) => a.case_id - b.case_id);
      return { rows };
    }

    if (statement.startsWith("INSERT INTO public.bot_evidence_views")) {
      const key = `${values[0]}:${values[1]}:${values[2]}`;
      state.views.add(key);
      return { rows: [] };
    }
    if (statement.startsWith("SELECT case_id, evidence_id FROM public.bot_evidence_views")) {
      const prefix = `${values[0]}:`;
      const rows = [...state.views]
        .filter((key) => key.startsWith(prefix))
        .map((key) => {
          const [, caseId, evidenceId] = key.split(":");
          return { case_id: Number(caseId), evidence_id: evidenceId };
        });
      return { rows };
    }

    if (statement.startsWith("INSERT INTO public.bot_update_receipts")) {
      const id = String(values[0]);
      if (state.receipts.has(id)) return { rows: [] };
      state.receipts.set(id, { actions: [], delivered_at: null });
      return { rows: [{ update_id: id }] };
    }
    if (statement.startsWith("SELECT actions, delivered_at FROM public.bot_update_receipts")) {
      const receipt = state.receipts.get(String(values[0]));
      return { rows: receipt ? [structuredClone(receipt)] : [] };
    }
    if (statement.startsWith("UPDATE public.bot_update_receipts SET actions = $2::jsonb")) {
      const receipt = state.receipts.get(String(values[0]));
      if (receipt) receipt.actions = JSON.parse(values[1]);
      return { rows: [], rowCount: receipt ? 1 : 0 };
    }
    if (statement.startsWith("UPDATE public.bot_update_receipts SET delivered_at")) {
      const receipt = state.receipts.get(String(values[0]));
      if (receipt) {
        receipt.delivered_at ??= "2026-12-20T09:06:00.000Z";
        receipt.actions = [];
      }
      return { rows: [], rowCount: receipt ? 1 : 0 };
    }

    throw new Error(`Unexpected mock SQL: ${statement}`);
  }

  return {
    query,
    async connect() {
      return { query, release() {} };
    },
    async end() {},
    failNextProgressInsert() {
      failNextProgressInsert = true;
    },
    progressRow(playerId, caseId) {
      const row = rowFor(String(playerId), caseId);
      return row ? { ...row } : null;
    },
    receiptCount() {
      return state.receipts.size;
    },
    progressCount() {
      return state.progress.size;
    },
  };
}

function telegramUpdate(updateId, text = "/case 1") {
  return {
    update_id: updateId,
    message: {
      message_id: updateId + 100,
      chat: { id: 42, type: "private" },
      from: { id: 1001 },
      text,
    },
  };
}

function createResponseRecorder() {
  const chunks = [];
  let finish;
  const finished = new Promise((resolve) => { finish = resolve; });
  const response = {
    statusCode: 200,
    headers: {},
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      Object.assign(this.headers, headers);
    },
    end(chunk) {
      if (chunk) chunks.push(Buffer.from(chunk));
      finish();
    },
    on() {},
  };
  return { response, finished, text: () => Buffer.concat(chunks).toString("utf8") };
}

// The sandbox forbids loopback TCP, so the webhook is exercised through the
// real Node request listener with streamed mock requests. Routing, secret
// validation, JSON parsing, transaction handling and dispatch all run.
async function startServer(pool) {
  const server = createBotServer({
    token: "test-token",
    webhookSecret: "test-secret",
    previewMode: true,
    timeZone: "UTC",
    progressStore: createPostgresProgressStore({ pool }),
  });
  const handler = server.listeners("request")[0];

  async function request({ method = "POST", path = "/telegram/webhook", headers = {}, body } = {}) {
    const payload = body === undefined ? [] : [Buffer.from(typeof body === "string" ? body : JSON.stringify(body))];
    const requestStream = Readable.from(payload);
    requestStream.method = method;
    requestStream.url = path;
    requestStream.headers = headers;
    const recorder = createResponseRecorder();
    handler(requestStream, recorder.response);
    await recorder.finished;
    const text = recorder.text();
    return {
      status: recorder.response.statusCode,
      body: text ? JSON.parse(text) : null,
    };
  }

  return {
    server,
    request,
    async close() {},
  };
}

function installTelegramMock() {
  const calls = [];
  let failNextSendMessage = false;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (!target.includes("api.telegram.org")) {
      return originalFetch(url, init);
    }
    const method = target.split("/").pop();
    const call = { method, init, failed: false };
    calls.push(call);
    if (failNextSendMessage && method === "sendMessage") {
      failNextSendMessage = false;
      call.failed = true;
      return { ok: false, status: 500, json: async () => ({ ok: false }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: calls.length } }) };
  };

  return {
    calls,
    failNextSendMessage() {
      failNextSendMessage = true;
    },
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

async function postUpdate(app, update, secret = "test-secret") {
  return app.request({
    method: "POST",
    path: "/telegram/webhook",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": secret,
    },
    body: update,
  });
}

test("HTTP webhook: секрет, выдача дела, фото и дедупликация update_id", async (t) => {
  const pool = createIntegrationPool();
  const telegram = installTelegramMock();
  const app = await startServer(pool);
  t.after(async () => {
    telegram.restore();
    await app.close();
  });

  const health = await app.request({ method: "GET", path: "/health", headers: {} });
  assert.equal(health.status, 200);
  assert.equal(health.body.service, "12-days-telegram-bot");

  const forbidden = await postUpdate(app, telegramUpdate(1), "wrong-secret");
  assert.equal(forbidden.status, 403);

  const first = await postUpdate(app, telegramUpdate(2));
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { ok: true, duplicate: false });
  assert.deepEqual(telegram.calls.map((call) => call.method), ["sendMessage", "sendPhoto"]);
  const messagePayload = JSON.parse(telegram.calls[0].init.body);
  assert.match(messagePayload.text, /ДЕЛО № 01/u);
  assert.equal(messagePayload.chat_id, 42);
  assert.equal(messagePayload.reply_markup.inline_keyboard[0][0].callback_data, "hint:1:1");
  const photoForm = telegram.calls[1].init.body;
  assert.ok(photoForm instanceof FormData);
  assert.equal(photoForm.get("caption"), "Улики к делу №01");
  assert.equal(pool.progressRow(1001, 1).status, "in_progress");

  const beforeDuplicate = telegram.calls.length;
  const duplicate = await postUpdate(app, telegramUpdate(2));
  assert.equal(duplicate.status, 200);
  assert.deepEqual(duplicate.body, { ok: true, duplicate: true });
  assert.equal(telegram.calls.length, beforeDuplicate, "дубликат не должен отправлять сообщения повторно");
  assert.equal(pool.progressRow(1001, 1).attempts_count, 0);
});

test("HTTP webhook: сбой Telegram оставляет receipt и повторяет actions", async (t) => {
  const pool = createIntegrationPool();
  const telegram = installTelegramMock();
  const app = await startServer(pool);
  t.after(async () => {
    telegram.restore();
    await app.close();
  });

  telegram.failNextSendMessage();
  const failed = await postUpdate(app, telegramUpdate(10));
  assert.equal(failed.status, 500);
  assert.deepEqual(failed.body, { ok: false, error: "processing_failed" });
  assert.equal(pool.receiptCount(), 1);

  const retry = await postUpdate(app, telegramUpdate(10));
  assert.equal(retry.status, 200);
  assert.deepEqual(retry.body, { ok: true, duplicate: true });
  const sentTexts = telegram.calls
    .filter((call) => call.method === "sendMessage" && !call.failed)
    .map((call) => JSON.parse(call.init.body).text);
  assert.equal(sentTexts.filter((text) => /ДЕЛО № 01/u.test(text)).length, 1, "дело должно быть отправлено ровно один раз");
});

test("HTTP webhook: ошибка БД откатывает receipt, повтор обрабатывает update заново", async (t) => {
  const pool = createIntegrationPool();
  const telegram = installTelegramMock();
  const app = await startServer(pool);
  t.after(async () => {
    telegram.restore();
    await app.close();
  });

  pool.failNextProgressInsert();
  const failed = await postUpdate(app, telegramUpdate(20));
  assert.equal(failed.status, 500);
  assert.equal(pool.receiptCount(), 0, "receipt должен откатиться вместе с прогрессом");
  assert.equal(pool.progressCount(), 0);

  const retry = await postUpdate(app, telegramUpdate(20));
  assert.equal(retry.status, 200);
  assert.deepEqual(retry.body, { ok: true, duplicate: false });
  assert.equal(pool.receiptCount(), 1);
  assert.equal(pool.progressRow(1001, 1).status, "in_progress");
});

test("HTTP webhook: ответ на дело 08 через HTTP даёт строгую проверку и прогресс", async (t) => {
  const pool = createIntegrationPool();
  const telegram = installTelegramMock();
  const app = await startServer(pool);
  t.after(async () => {
    telegram.restore();
    await app.close();
  });

  const issued = await postUpdate(app, telegramUpdate(30, "/case 8"));
  assert.equal(issued.status, 200);
  const caseText = JSON.parse(telegram.calls[0].init.body).text;
  assert.match(caseText, /ДЕЛО № 08/u);

  const replyUpdate = (updateId, text) => ({
    update_id: updateId,
    message: {
      message_id: updateId + 100,
      chat: { id: 42, type: "private" },
      from: { id: 1001 },
      text,
      reply_to_message: { message_id: 130, text: caseText },
    },
  });

  const invalid = await postUpdate(app, replyUpdate(31, "2346"));
  assert.equal(invalid.status, 200);
  assert.match(JSON.parse(telegram.calls.at(-1).init.body).text, /строгий формат чч:мм/u);
  assert.equal(pool.progressRow(1001, 8).attempts_count, 0);

  const trap = await postUpdate(app, replyUpdate(32, "23:42"));
  assert.equal(trap.status, 200);
  assert.match(JSON.parse(telegram.calls.at(-1).init.body).text, /время на кадре/u);
  assert.equal(pool.progressRow(1001, 8).attempts_count, 1);

  const correct = await postUpdate(app, replyUpdate(33, "23:46"));
  assert.equal(correct.status, 200);
  assert.match(JSON.parse(telegram.calls.at(-1).init.body).text, /Кадр снят в 23:46/u);
  assert.equal(pool.progressRow(1001, 8).status, "completed");
  assert.equal(pool.progressRow(1001, 8).attempts_count, 2);
});

test("HTTP webhook: /archive → карточка дела → улика через editMessage и фото", async (t) => {
  const pool = createIntegrationPool();
  const telegram = installTelegramMock();
  const app = await startServer(pool);
  t.after(async () => {
    telegram.restore();
    await app.close();
  });

  await postUpdate(app, telegramUpdate(40, "/case 1"));

  const archive = await postUpdate(app, telegramUpdate(41, "/archive"));
  assert.equal(archive.status, 200);
  const archiveText = JSON.parse(telegram.calls.at(-1).init.body).text;
  assert.match(archiveText, /АРХИВ РАССЛЕДОВАНИЯ/u);
  assert.match(archiveText, /Открыто дел: 1 из 12/u);

  const callbackUpdate = (updateId, data, messageId) => ({
    update_id: updateId,
    callback_query: {
      id: `cb-${updateId}`,
      from: { id: 1001 },
      data,
      message: { message_id: messageId, chat: { id: 42, type: "private" } },
    },
  });

  const caseView = await postUpdate(app, callbackUpdate(42, "ar:c:1:all:0", 141));
  assert.equal(caseView.status, 200);
  assert.deepEqual(telegram.calls.slice(-2).map((call) => call.method), ["answerCallbackQuery", "editMessageText"]);
  const editPayload = JSON.parse(telegram.calls.at(-1).init.body);
  assert.equal(editPayload.message_id, 141);
  assert.match(editPayload.text, /ДЕЛО 01 · ПЯТЬ МИНУТ ТИШИНЫ/u);
  assert.match(editPayload.text, /· новое/u);

  const evidence = await postUpdate(app, callbackUpdate(43, "ar:e:1:a:all:0", 141));
  assert.equal(evidence.status, 200);
  assert.deepEqual(telegram.calls.slice(-2).map((call) => call.method), ["answerCallbackQuery", "sendPhoto"]);
  const photoForm = telegram.calls.at(-1).init.body;
  assert.match(photoForm.get("caption"), /ВЫГРУЗКА МУЗЫКАЛЬНОГО СЕРВЕРА/u);
  assert.match(photoForm.get("caption"), /23:36:00/u);
  assert.match(photoForm.get("reply_markup"), /ar:c:1:all:0/u);

  await postUpdate(app, callbackUpdate(44, "ar:c:1:all:0", 141));
  const reopenedCaseText = JSON.parse(telegram.calls.at(-1).init.body).text;
  assert.match(reopenedCaseText, /1\. ВЫГРУЗКА МУЗЫКАЛЬНОГО СЕРВЕРА\n2\. ПРИМЕЧАНИЕ ТЕХНИКА · новое/u);
  assert.doesNotMatch(reopenedCaseText, /1\. ВЫГРУЗКА МУЗЫКАЛЬНОГО СЕРВЕРА · новое/u);
});
