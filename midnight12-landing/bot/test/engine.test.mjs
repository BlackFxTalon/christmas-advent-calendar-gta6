import test from "node:test";
import assert from "node:assert/strict";
import { handleUpdate, getAvailableCaseId, isCorrectAnswer } from "../engine.mjs";
import { createPostgresProgressStore } from "../progress-store.mjs";

function message(text, extras = {}) {
  return { message: { chat: { id: 42, type: "private" }, from: { id: 1001 }, text, ...extras } };
}

function createMemoryProgressStore() {
  const rows = new Map();
  const keyFor = (playerId, caseId) => `${playerId}:${caseId}`;
  const rowFor = (playerId, caseId) => {
    const key = keyFor(playerId, caseId);
    let row = rows.get(key);
    if (!row) {
      row = {
        case_id: Number(caseId),
        status: "in_progress",
        attempts_count: 0,
        hints_used: 0,
        started_at: new Date().toISOString(),
        completed_at: null,
      };
      rows.set(key, row);
    }
    return row;
  };

  return {
    async markCaseIssued(playerId, caseId) {
      return rowFor(playerId, caseId);
    },
    async recordHint(playerId, caseId, step) {
      const row = rowFor(playerId, caseId);
      row.hints_used = Math.max(row.hints_used, Number(step));
      return row;
    },
    async recordAttempt(playerId, caseId, isCorrect) {
      const row = rowFor(playerId, caseId);
      row.attempts_count += 1;
      if (isCorrect) {
        row.status = "completed";
        row.completed_at ??= new Date().toISOString();
      }
      return row;
    },
    async getProgress(playerId) {
      return [...rows.entries()]
        .filter(([key]) => key.startsWith(`${playerId}:`))
        .map(([, row]) => ({ ...row }))
        .sort((a, b) => a.case_id - b.case_id);
    },
    snapshot(playerId, caseId) {
      const row = rows.get(keyFor(playerId, caseId));
      return row ? { ...row } : null;
    },
  };
}

async function run(update, options = {}) {
  return handleUpdate(update, {
    progressStore: createMemoryProgressStore(),
    ...options,
  });
}

test("календарь выдаёт дела 1–3 на 20–22 декабря", () => {
  assert.equal(getAvailableCaseId(new Date("2026-12-20T12:00:00Z"), "UTC"), 1);
  assert.equal(getAvailableCaseId(new Date("2026-12-21T12:00:00Z"), "UTC"), 2);
  assert.equal(getAvailableCaseId(new Date("2026-12-22T12:00:00Z"), "UTC"), 3);
  assert.equal(getAvailableCaseId(new Date("2026-12-23T12:00:00Z"), "UTC"), null);
});

test("/start показывает команды бота и объясняет сохранение прогресса", async () => {
  const [reply] = await run(message("/start"));
  assert.match(reply.text, /12 дней до полуночи/u);
  assert.match(reply.text, /Прогресс сохраняется автоматически/u);
  assert.equal(reply.replyMarkup.inline_keyboard.length, 2);
});

test("/case 1 выдаётся в тестовом режиме с текстом и карточкой улики", async () => {
  const store = createMemoryProgressStore();
  const actions = await handleUpdate(message("/case 1"), { previewMode: true, progressStore: store });
  assert.equal(actions.length, 2);
  assert.match(actions[0].text, /ДЕЛО № 01/u);
  assert.equal(actions[1].type, "photo");
  assert.match(actions[1].filePath, /case-01-evidence\.png$/u);
  assert.equal(store.snapshot("1001", 1).status, "in_progress");
});

test("тестовая ручная выдача закрыта вне preview mode", async () => {
  const [reply] = await run(message("/case 1"), { previewMode: false });
  assert.match(reply.text, /выключена/u);
});

test("бот проверяет точные ответы и допустимые варианты", () => {
  assert.equal(isCorrectAnswer(1, "23:30:55"), true);
  assert.equal(isCorrectAnswer(1, "23:31"), true);
  assert.equal(isCorrectAnswer(2, "23:37"), true);
  assert.equal(isCorrectAnswer(3, "пирс B-2"), true);
  assert.equal(isCorrectAnswer(3, "C-3"), false);
});

test("верный ответ завершает дело и сохраняет попытку", async () => {
  const store = createMemoryProgressStore();
  const [caseAction] = await handleUpdate(message("/case 1"), { previewMode: true, progressStore: store });
  const [reply] = await handleUpdate(
    message("23:30:55", { reply_to_message: { text: caseAction.text } }),
    { progressStore: store },
  );
  assert.match(reply.text, /Верно: запись началась в 23:30:55/u);
  assert.equal(store.snapshot("1001", 1).status, "completed");
  assert.equal(store.snapshot("1001", 1).attempts_count, 1);
});

test("ошибочный ответ сохраняет попытку и не блокирует верную", async () => {
  const store = createMemoryProgressStore();
  const [caseAction] = await handleUpdate(message("/case 2"), { previewMode: true, progressStore: store });
  const wrong = await handleUpdate(
    message("23:44", { reply_to_message: { text: caseAction.text } }),
    { progressStore: store },
  );
  const right = await handleUpdate(
    message("23:37", { reply_to_message: { text: caseAction.text } }),
    { progressStore: store },
  );
  assert.match(wrong[0].text, /поправку нужно вычесть/u);
  assert.match(right[0].text, /Верно: заказ сделан в 23:37/u);
  assert.equal(store.snapshot("1001", 2).attempts_count, 2);
  assert.equal(store.snapshot("1001", 2).status, "completed");
});

test("подсказки из callback и команды учитываются, /progress показывает состояние", async () => {
  const store = createMemoryProgressStore();
  const caseAction = await handleUpdate(message("/case 1"), { previewMode: true, progressStore: store });
  const callback = await handleUpdate({
    callback_query: {
      id: "cb-1",
      from: { id: 1001 },
      data: "hint:1:1",
      message: { chat: { id: 42 }, message_id: 10 },
    },
  }, { progressStore: store });
  assert.equal(callback[0].type, "callbackAck");
  assert.match(callback[1].text, /Подсказка 1 из 3/u);
  assert.equal(callback[1].replyMarkup.inline_keyboard[0][0].callback_data, "hint:1:2");

  await handleUpdate(message("/hint 1 3"), { progressStore: store });
  const [progress] = await handleUpdate(message("/progress"), { progressStore: store });
  assert.match(progress.text, /Решено: 0 из 3/u);
  assert.match(progress.text, /Пять минут тишины — в работе; попыток: 0; подсказок: 3/u);
  assert.equal(store.snapshot("1001", 1).hints_used, 3);
  assert.match(caseAction[0].text, /ДЕЛО № 01/u);
});

test("/progress не раскрывает личную сводку в групповом чате", async () => {
  const [reply] = await handleUpdate(message("/progress", {
    chat: { id: -100123, type: "supergroup" },
  }), {
    progressStore: {
      async getProgress() {
        throw new Error("Group chats must not read private progress.");
      },
    },
  });
  assert.match(reply.text, /только в личном чате/u);
});

test("повторная выдача завершённого дела не сбрасывает его статус", async () => {
  const store = createMemoryProgressStore();
  const [caseAction] = await handleUpdate(message("/case 1"), { previewMode: true, progressStore: store });
  await handleUpdate(message("23:30:55", { reply_to_message: { text: caseAction.text } }), { progressStore: store });
  await handleUpdate(message("/case 1"), { previewMode: true, progressStore: store });
  assert.equal(store.snapshot("1001", 1).status, "completed");
});

test("без reply на сообщение бота нельзя перепутать номер дела", async () => {
  const [reply] = await run(message("23:30:55"));
  assert.match(reply.text, /ответь на сообщение с загадкой/u);
});

test("PostgreSQL adapter использует параметризованные запросы и Telegram ID как строку", async () => {
  const calls = [];
  const pool = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      return { rows: [] };
    },
    async end() {},
  };
  const store = createPostgresProgressStore({ pool });
  await store.recordAttempt(9_876_543_210, 3, true);
  await store.recordHint("9876543210", 3, 2);
  await store.getProgress("9876543210");

  assert.equal(calls[0].values[0], "9876543210");
  assert.deepEqual(calls[1].values, ["9876543210", 3, true]);
  assert.deepEqual(calls[3].values, ["9876543210", 3, 2]);
  assert.deepEqual(calls[4].values, ["9876543210"]);
  assert.match(calls[1].sql, /ON CONFLICT \(telegram_user_id, case_id\)/u);
  assert.match(calls[1].sql, /attempts_count = bot_case_progress\.attempts_count \+ 1/u);
  assert.equal(calls.some(({ sql }) => sql.includes("9876543210")), false);
  await store.close();
});

test("PostgreSQL adapter rejects invalid Telegram IDs before SQL", async () => {
  const calls = [];
  const store = createPostgresProgressStore({
    pool: {
      async query(sql, values) {
        calls.push({ sql, values });
        return { rows: [] };
      },
    },
  });
  for (const invalidId of ["0", "000", "-1", "9223372036854775808"]) {
    await assert.rejects(() => store.getProgress(invalidId), /positive integer/u);
  }
  assert.equal(calls.length, 0);
  await store.close();
});

test("PostgreSQL adapter требует DATABASE_URL, если пул не передан явно", () => {
  assert.throws(
    () => createPostgresProgressStore({ connectionString: "", pool: null }),
    /DATABASE_URL/u,
  );
});
