// Non-interactive end-to-end simulation of all 12 cases through the same
// engine the webhook uses. No database, Telegram token or network required.
import { handleUpdate, getAvailableCaseId } from "../engine.mjs";
import { CASES } from "../cases.mjs";

const PLAYER_ID = 1001;
const CHAT_ID = 42;
const TIME_ZONE = "Europe/Moscow";

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

function message(text, replyTo) {
  return {
    message: {
      chat: { id: CHAT_ID, type: "private" },
      from: { id: PLAYER_ID },
      text,
      ...(replyTo ? { reply_to_message: { text: replyTo } } : {}),
    },
  };
}

const failures = [];
const store = createMemoryProgressStore();

function check(condition, label) {
  if (!condition) failures.push(label);
}

console.log("Симуляция календаря 20–31 декабря");
for (let day = 20; day <= 31; day += 1) {
  const date = new Date(`2026-12-${day}T09:00:00+03:00`);
  const expected = day - 19;
  const actual = getAvailableCaseId(date, TIME_ZONE);
  check(actual === expected, `календарь ${day} декабря → дело ${expected}, получено ${actual}`);
  console.log(`  ${day} декабря → дело №${String(actual).padStart(2, "0")}`);
}
check(getAvailableCaseId(new Date("2026-12-19T12:00:00+03:00"), TIME_ZONE) === null, "19 декабря не выдаёт дело");
check(getAvailableCaseId(new Date("2027-01-01T12:00:00+03:00"), TIME_ZONE) === null, "1 января не выдаёт дело");

console.log("\nСимуляция всех дел");
for (const item of CASES) {
  const issued = await handleUpdate(message(`/case ${item.id}`), {
    previewMode: true,
    timeZone: TIME_ZONE,
    progressStore: store,
  });
  const caseText = issued[0]?.text ?? "";
  check(caseText.includes(`ДЕЛО № ${String(item.id).padStart(2, "0")}`), `дело ${item.id}: заголовок не найден`);
  check(issued.some((action) => action.type === "photo"), `дело ${item.id}: нет фото-карточки`);

  const hint = await handleUpdate(message(`/hint ${item.id} 1`), {
    timeZone: TIME_ZONE,
    progressStore: store,
  });
  check(hint[0]?.text.includes("Подсказка 1 из 3"), `дело ${item.id}: подсказка не выдана`);

  const answer = item.answers[0];
  const reply = await handleUpdate(message(answer, caseText), {
    timeZone: TIME_ZONE,
    progressStore: store,
  });
  const row = store.snapshot(PLAYER_ID, item.id);
  check(reply[0]?.text === item.correct, `дело ${item.id}: текст верного ответа не совпал`);
  check(row?.status === "completed", `дело ${item.id}: статус ${row?.status}`);
  console.log(`  №${String(item.id).padStart(2, "0")} ${item.title} — ответ «${answer}» — ${row?.status}`);
}

const progress = await handleUpdate(message("/progress"), { timeZone: TIME_ZONE, progressStore: store });
check(progress[0]?.text.includes("Решено: 12 из 12"), "итоговый прогресс не 12 из 12");
console.log(`\n${progress[0].text.split("\n").slice(0, 2).join(" · ")}`);

if (failures.length) {
  console.error(`\nПровалено проверок: ${failures.length}`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log("\nВсе проверки пройдены: календарь, 12 дел, подсказки и ответы.");
}
