import test from "node:test";
import assert from "node:assert/strict";
import { handleUpdate, getAvailableCaseId, isCorrectAnswer, evaluateAnswer } from "../engine.mjs";
import { CASES } from "../cases.mjs";
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

test("календарь выдаёт дела 1–12 на 20–31 декабря", () => {
  for (let day = 20; day <= 31; day += 1) {
    const date = new Date(`2026-12-${day}T12:00:00Z`);
    assert.equal(getAvailableCaseId(date, "UTC"), day - 19);
  }
  assert.equal(getAvailableCaseId(new Date("2026-12-19T12:00:00Z"), "UTC"), null);
  assert.equal(getAvailableCaseId(new Date("2027-01-01T12:00:00Z"), "UTC"), null);
});

test("каталог содержит 12 дел с последовательными номерами и полным набором полей", () => {
  assert.equal(CASES.length, 12);
  CASES.forEach((item, index) => {
    assert.equal(item.id, index + 1);
    assert.equal(item.date.month, 12);
    assert.equal(item.date.day, 20 + index);
    assert.equal(item.hints.length, 3);
    assert.ok(item.answers.length > 0);
    assert.ok(item.prompt.length > 0);
    assert.ok(item.materials.length > 0);
    assert.ok(item.correct.length > 0);
    assert.ok(item.incorrect.length > 0);
  });
});

test("каждое дело принимает свой канонический ответ", () => {
  for (const item of CASES) {
    assert.equal(isCorrectAnswer(item.id, item.answers[0]), true, `дело №${item.id}`);
  }
});

test("/start показывает команды бота и объясняет сохранение прогресса", async () => {
  const [reply] = await run(message("/start"));
  assert.match(reply.text, /12 дней до полуночи/u);
  assert.match(reply.text, /Прогресс сохраняется автоматически/u);
  assert.equal(reply.replyMarkup.inline_keyboard.length, 3);
  assert.equal(reply.replyMarkup.inline_keyboard[1][0].callback_data, "ar:l:all:0");
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

test("дело 08 требует строгий чч:мм и различает ловушки", () => {
  assert.equal(isCorrectAnswer(8, "23:46"), true);
  assert.equal(isCorrectAnswer(8, "в 23:46"), true);
  assert.equal(evaluateAnswer(8, "23:42").status, "trap");
  assert.match(evaluateAnswer(8, "23:42").message, /время на кадре/u);
  assert.equal(evaluateAnswer(8, "23:38").status, "trap");
  assert.match(evaluateAnswer(8, "23:38").message, /вычесть/u);
  for (const malformed of ["2346", "23.46", "23:46:00", "25:00", "23:75", "полночь"]) {
    assert.equal(evaluateAnswer(8, malformed).status, "invalid", malformed);
  }
});

test("ошибка формата в деле 08 не засчитывается как попытка", async () => {
  const store = createMemoryProgressStore();
  const [caseAction] = await handleUpdate(message("/case 8"), { previewMode: true, progressStore: store });
  const [invalid] = await handleUpdate(
    message("2346", { reply_to_message: { text: caseAction.text } }),
    { progressStore: store },
  );
  assert.match(invalid.text, /строгий формат чч:мм/u);
  assert.equal(store.snapshot("1001", 8).attempts_count, 0);

  const [trap] = await handleUpdate(
    message("23:42", { reply_to_message: { text: caseAction.text } }),
    { progressStore: store },
  );
  assert.match(trap.text, /время на кадре/u);
  assert.equal(store.snapshot("1001", 8).attempts_count, 1);

  const [right] = await handleUpdate(
    message("23:46", { reply_to_message: { text: caseAction.text } }),
    { progressStore: store },
  );
  assert.match(right.text, /Кадр снят в 23:46/u);
  assert.equal(store.snapshot("1001", 8).status, "completed");
});

test("дело 10 принимает дату и время и объясняет ловушку 11:49", () => {
  assert.equal(isCorrectAnswer(10, "20 декабря, 11:48:12"), true);
  assert.equal(isCorrectAnswer(10, "11:48"), true);
  assert.equal(isCorrectAnswer(10, "20 декабря в 11:48"), true);
  assert.equal(evaluateAnswer(10, "11:49").status, "trap");
  assert.match(evaluateAnswer(10, "11:49").message, /время заявления/u);
  assert.equal(evaluateAnswer(10, "завтра").status, "invalid");
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
  assert.match(progress.text, /Решено: 0 из 12/u);
  assert.match(progress.text, /Пять минут тишины — в работе; попыток: 0; подсказок: 3/u);
  assert.equal(store.snapshot("1001", 1).hints_used, 3);
  assert.match(caseAction[0].text, /ДЕЛО № 01/u);
});

test("все 12 дел выдаются в тестовом режиме и сохраняют прогресс", async () => {
  for (const item of CASES) {
    const store = createMemoryProgressStore();
    const actions = await handleUpdate(message(`/case ${item.id}`), { previewMode: true, progressStore: store });
    assert.match(actions[0].text, new RegExp(`ДЕЛО № ${String(item.id).padStart(2, "0")}`, "u"));
    assert.equal(actions[1]?.type, "photo");
    assert.match(actions[1].filePath, new RegExp(`case-${String(item.id).padStart(2, "0")}-evidence\\.png$`, "u"));
    assert.equal(store.snapshot("1001", item.id).status, "in_progress");
  }
});

test("/today вне календаря объясняет даты 20–31 декабря", async () => {
  const [reply] = await handleUpdate(message("/today"), {
    now: new Date("2026-12-19T12:00:00Z"),
    timeZone: "UTC",
    progressStore: createMemoryProgressStore(),
  });
  assert.match(reply.text, /с 20 по 31 декабря/u);
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

function createReceiptPool() {
  const receipts = new Map();
  let snapshot = null;
  const cloneReceipts = () => new Map(
    [...receipts.entries()].map(([key, value]) => [key, structuredClone(value)]),
  );

  async function query(sql, values = []) {
    const statement = sql.replace(/\s+/gu, " ").trim();
    if (statement === "BEGIN") {
      snapshot = cloneReceipts();
      return { rows: [] };
    }
    if (statement === "COMMIT") {
      snapshot = null;
      return { rows: [] };
    }
    if (statement === "ROLLBACK") {
      if (snapshot) {
        receipts.clear();
        for (const [key, value] of snapshot) receipts.set(key, value);
      }
      snapshot = null;
      return { rows: [] };
    }
    if (statement.startsWith("INSERT INTO public.bot_update_receipts")) {
      const id = String(values[0]);
      if (receipts.has(id)) return { rows: [] };
      receipts.set(id, { actions: [], delivered_at: null });
      return { rows: [{ update_id: id }] };
    }
    if (statement.startsWith("SELECT actions, delivered_at FROM public.bot_update_receipts")) {
      const receipt = receipts.get(String(values[0]));
      return { rows: receipt ? [structuredClone(receipt)] : [] };
    }
    if (statement.startsWith("UPDATE public.bot_update_receipts SET actions = $2::jsonb")) {
      const receipt = receipts.get(String(values[0]));
      if (receipt) receipt.actions = JSON.parse(values[1]);
      return { rows: [], rowCount: receipt ? 1 : 0 };
    }
    if (statement.startsWith("UPDATE public.bot_update_receipts SET delivered_at")) {
      const receipt = receipts.get(String(values[0]));
      if (receipt) {
        receipt.delivered_at ??= new Date().toISOString();
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
  };
}

test("PostgreSQL adapter дедуплицирует update_id и повторяет недоставленные actions", async () => {
  const store = createPostgresProgressStore({ pool: createReceiptPool() });
  let handlerCalls = 0;
  const first = await store.processUpdate(17, async () => {
    handlerCalls += 1;
    return [
      { type: "message", text: "ответ" },
      { type: "callbackAck", callbackQueryId: "old-callback" },
    ];
  });
  const retry = await store.processUpdate("17", async () => {
    handlerCalls += 1;
    return [];
  });

  assert.equal(first.duplicate, false);
  assert.equal(retry.duplicate, true);
  assert.deepEqual(retry.actions, [{ type: "message", text: "ответ" }]);
  await store.markUpdateDelivered(17);
  const deliveredRetry = await store.processUpdate(17, async () => {
    handlerCalls += 1;
    return [];
  });
  assert.deepEqual(deliveredRetry.actions, []);
  assert.equal(handlerCalls, 1);
  await assert.rejects(() => store.processUpdate(-1, async () => []), /non-negative integer/u);
  await store.close();
});

test("PostgreSQL adapter rolls back a failed update so Telegram can retry it", async () => {
  const store = createPostgresProgressStore({ pool: createReceiptPool() });
  await assert.rejects(
    () => store.processUpdate(18, async () => { throw new Error("temporary failure"); }),
    /temporary failure/u,
  );
  const retry = await store.processUpdate(18, async () => [{ type: "message", text: "повтор" }]);
  assert.equal(retry.duplicate, false);
  assert.deepEqual(retry.actions, [{ type: "message", text: "повтор" }]);
  await store.close();
});

test("PostgreSQL adapter требует DATABASE_URL, если пул не передан явно", () => {
  assert.throws(
    () => createPostgresProgressStore({ connectionString: "", pool: null }),
    /DATABASE_URL/u,
  );
});
