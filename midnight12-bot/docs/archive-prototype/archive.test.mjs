import test from "node:test";
import assert from "node:assert/strict";
import { buildArchiveList, handleArchiveCallback, handleArchiveCommand, parseArchiveCallback } from "./archive.mjs";
import { CASE_08, checkTimeAnswer, parseClockTime } from "./case-08.mjs";

const CASES = [
  { id: 1, title: "Пять минут тишины", evidence: [{ id: "server", title: "Выгрузка сервера", text: "ПОСЛЕДНЯЯ НОТА: 23:36:00" }], summary: "Запись началась в 23:30:55." },
  { id: 2, title: "Часы спешат", evidence: [] },
  ...Array.from({ length: 5 }, (_, i) => ({ id: i + 3, title: `Дело ${i + 3}`, evidence: [] })),
  CASE_08,
];

function stores(rows) {
  const viewed = new Set();
  return {
    progressStore: { async getProgress() { return rows; } },
    evidenceStore: {
      async getViewed() { return new Set(viewed); },
      async markViewed(_p, caseId, evId) { viewed.add(`${caseId}:${evId}`); },
    },
  };
}

const query = (data) => ({ id: "q1", data, from: { id: 1001 }, message: { message_id: 77, chat: { id: 42, type: "private" } } });

test("callback_data укладывается в 64 байта и разбирается обратно", () => {
  const data = "ar:e:12:h3-frame:solved:9";
  assert.ok(Buffer.byteLength(data) <= 64);
  assert.deepEqual(parseArchiveCallback(data), { action: "evidence", caseId: 12, evidenceId: "h3-frame", view: "solved", page: 9 });
  assert.equal(parseArchiveCallback("ar:c:1:bad:0"), null);
});

test("архив показывает только выданные дела и фильтрует по статусу", () => {
  const rows = [{ case_id: 1, status: "completed" }, { case_id: 8, status: "in_progress" }];
  const all = buildArchiveList({ cases: CASES, progressRows: rows });
  assert.match(all.text, /Открыто дел: 2 из 8 · решено: 1/u);
  assert.doesNotMatch(all.text, /Часы спешат/u);
  const open = buildArchiveList({ cases: CASES, progressRows: rows, view: "open" });
  assert.match(open.text, /Четыре минуты/u);
  assert.doesNotMatch(open.text, /Пять минут/u);
});

test("пагинация: 8 открытых дел дают две страницы", () => {
  const rows = CASES.map((c) => ({ case_id: c.id, status: "in_progress" }));
  const first = buildArchiveList({ cases: CASES, progressRows: rows });
  assert.match(first.text, /стр\. 1\/2/u);
  const nav = first.replyMarkup.inline_keyboard.flat().find((b) => b.text === "Дальше →");
  assert.equal(nav.callback_data, "ar:l:all:1");
});

test("подделанный callback к закрытому делу не раскрывает улики", async () => {
  const actions = await handleArchiveCallback(query("ar:e:8:h3-frame:all:0"), { cases: CASES, ...stores([]) });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "callbackAck");
  assert.equal(actions[0].text, "Это дело ещё не открыто.");
});

test("открытие улики отправляет фото с кнопкой возврата и снимает метку «новое»", async () => {
  const s = stores([{ case_id: 8, status: "in_progress" }]);
  const before = await handleArchiveCallback(query("ar:c:8:all:0"), { cases: CASES, ...s });
  assert.equal(before[1].type, "editMessage");
  assert.match(before[1].text, /Кадр камеры H-3 · новое/u);
  assert.doesNotMatch(before[1].text, /23:46/u, "архив не должен раскрывать ответ");

  const ev = await handleArchiveCallback(query("ar:e:8:h3-frame:all:0"), { cases: CASES, ...s });
  assert.equal(ev[1].type, "photo");
  assert.match(ev[1].caption, /ВРЕМЯ НА КАДРЕ: 23:42/u);
  assert.equal(ev[1].replyMarkup.inline_keyboard[0][0].callback_data, "ar:c:8:all:0");

  const after = await handleArchiveCallback(query("ar:c:8:all:0"), { cases: CASES, ...s });
  assert.doesNotMatch(after[1].text, /H-3 · новое/u);
});

test("итог показывается только для решённого дела", async () => {
  const s = stores([{ case_id: 1, status: "completed" }, { case_id: 8, status: "in_progress" }]);
  const solved = await handleArchiveCallback(query("ar:c:1:all:0"), { cases: CASES, ...s });
  assert.match(solved[1].text, /Итог: Запись началась/u);
  const open = await handleArchiveCallback(query("ar:c:8:all:0"), { cases: CASES, ...s });
  assert.doesNotMatch(open[1].text, /Итог:/u);
});

test("/archive в группе не раскрывает прогресс", async () => {
  const actions = await handleArchiveCommand({ chat: { id: -5, type: "group" }, from: { id: 1001 } }, { cases: CASES, ...stores([]) });
  assert.match(actions[0].text, /только в личном чате/u);
});

test("дело №08: строгая проверка времени и разбор типовых ошибок", () => {
  assert.equal(parseClockTime("23.46"), "23:46");
  assert.equal(parseClockTime(" 23 46 "), "23:46");
  assert.equal(parseClockTime("23:46:00"), "23:46");
  for (const bad of ["24:46", "23:60", "2346", "23:46:10", "около 23:46"]) assert.equal(parseClockTime(bad), null, bad);

  assert.equal(checkTimeAnswer(CASE_08, "23:46").outcome, "correct");
  assert.equal(checkTimeAnswer(CASE_08, "23:42").outcome, "trap");
  assert.equal(checkTimeAnswer(CASE_08, "23:38").outcome, "trap");
  assert.equal(checkTimeAnswer(CASE_08, "23:50").outcome, "wrong");
  const format = checkTimeAnswer(CASE_08, "без пятнадцати");
  assert.equal(format.outcome, "format");
  assert.equal(format.countsAsAttempt, false);
});
