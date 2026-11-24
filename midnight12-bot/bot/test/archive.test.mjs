import test from "node:test";
import assert from "node:assert/strict";
import {
  buildArchiveList,
  handleArchiveCallback,
  handleArchiveCommand,
  parseArchiveCallback,
} from "../archive.mjs";
import { CASES, getCaseById } from "../cases.mjs";

function stores(rows) {
  const viewed = new Set();
  return {
    progressStore: { async getProgress() { return rows; } },
    evidenceStore: {
      async getViewed() { return new Set(viewed); },
      async markViewed(_playerId, caseId, evidenceId) { viewed.add(`${caseId}:${evidenceId}`); },
    },
  };
}

const query = (data) => ({
  id: "q1",
  data,
  from: { id: 1001 },
  message: { message_id: 77, chat: { id: 42, type: "private" } },
});

test("материалы всех 12 дел разложены на отдельные улики", () => {
  assert.equal(CASES.length, 12);
  for (const item of CASES) {
    assert.ok(item.evidence.length >= 1, `дело ${item.id}`);
    for (const evidence of item.evidence) {
      assert.match(evidence.id, /^[a-z0-9-]{1,24}$/u);
      assert.ok(evidence.title.length > 0);
      assert.ok(evidence.text.length > 0);
    }
  }
  assert.deepEqual(getCaseById(8).evidence.map((ev) => ev.id), ["a"]);
  assert.deepEqual(getCaseById(12).evidence.map((ev) => ev.id), ["a", "b", "c"]);
});

test("callback_data архива укладывается в 64 байта и разбирается обратно", () => {
  const data = "ar:e:12:c:solved:9";
  assert.ok(Buffer.byteLength(data) <= 64);
  assert.deepEqual(parseArchiveCallback(data), {
    action: "evidence", caseId: 12, evidenceId: "c", view: "solved", page: 9,
  });
  assert.equal(parseArchiveCallback("ar:c:1:bad:0"), null);
});

test("архив показывает только выданные дела и фильтрует по статусу", () => {
  const rows = [{ case_id: 1, status: "completed" }, { case_id: 8, status: "in_progress" }];
  const all = buildArchiveList({ cases: CASES, progressRows: rows });
  assert.match(all.text, /Открыто дел: 2 из 12 · решено: 1/u);
  assert.doesNotMatch(all.text, /Часы спешат/u);
  const open = buildArchiveList({ cases: CASES, progressRows: rows, view: "open" });
  assert.match(open.text, /Четыре минуты/u);
  assert.doesNotMatch(open.text, /Пять минут/u);
});

test("пагинация: 12 открытых дел дают две страницы", () => {
  const rows = CASES.map((item) => ({ case_id: item.id, status: "in_progress" }));
  const first = buildArchiveList({ cases: CASES, progressRows: rows });
  assert.match(first.text, /стр\. 1\/2/u);
  const nav = first.replyMarkup.inline_keyboard.flat().find((button) => button.text === "Дальше →");
  assert.equal(nav.callback_data, "ar:l:all:1");
  const second = buildArchiveList({ cases: CASES, progressRows: rows, page: 1 });
  assert.match(second.text, /стр\. 2\/2/u);
  assert.equal(second.replyMarkup.inline_keyboard.flat().some((button) => button.text === "Дальше →"), false);
});

test("подделанный callback к закрытому делу не раскрывает улики", async () => {
  const actions = await handleArchiveCallback(query("ar:e:8:a:all:0"), { cases: CASES, ...stores([]) });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "callbackAck");
  assert.equal(actions[0].text, "Это дело ещё не открыто.");
});

test("открытие улики отправляет фото с кнопкой возврата и снимает метку «новое»", async () => {
  const state = stores([{ case_id: 8, status: "in_progress" }]);
  const before = await handleArchiveCallback(query("ar:c:8:all:0"), { cases: CASES, ...state });
  assert.equal(before[1].type, "editMessage");
  assert.match(before[1].text, /ВИДЕОКАМЕРА H-3 — СЛУЖЕБНОЙ КОРИДОР B-2 · новое/u);
  assert.doesNotMatch(before[1].text, /23:46/u, "архив не должен раскрывать ответ");

  const evidence = await handleArchiveCallback(query("ar:e:8:a:all:0"), { cases: CASES, ...state });
  assert.equal(evidence[1].type, "photo");
  assert.match(evidence[1].caption, /ВРЕМЯ НА КАДРЕ: 23:42/u);
  assert.equal(evidence[1].replyMarkup.inline_keyboard[0][0].callback_data, "ar:c:8:all:0");

  const after = await handleArchiveCallback(query("ar:c:8:all:0"), { cases: CASES, ...state });
  assert.doesNotMatch(after[1].text, /· новое/u);
});

test("итог показывается только для решённого дела", async () => {
  const state = stores([{ case_id: 1, status: "completed" }, { case_id: 8, status: "in_progress" }]);
  const solved = await handleArchiveCallback(query("ar:c:1:all:0"), { cases: CASES, ...state });
  assert.match(solved[1].text, /Итог: Верно: запись началась/u);
  const open = await handleArchiveCallback(query("ar:c:8:all:0"), { cases: CASES, ...state });
  assert.doesNotMatch(open[1].text, /Итог:/u);
});

test("/archive в группе не раскрывает прогресс", async () => {
  const actions = await handleArchiveCommand(
    { chat: { id: -5, type: "group" }, from: { id: 1001 } },
    { cases: CASES, ...stores([]) },
  );
  assert.match(actions[0].text, /только в личном чате/u);
});

test("/archive в личном чате строит список с кнопками", async () => {
  const actions = await handleArchiveCommand(
    { chat: { id: 42, type: "private" }, from: { id: 1001 } },
    { cases: CASES, ...stores([{ case_id: 1, status: "completed" }]) },
  );
  assert.match(actions[0].text, /АРХИВ РАССЛЕДОВАНИЯ/u);
  const buttons = actions[0].replyMarkup.inline_keyboard.flat();
  assert.ok(buttons.some((button) => button.callback_data === "ar:c:1:all:0"));
  assert.ok(buttons.some((button) => button.text === "[Все]"));
});
