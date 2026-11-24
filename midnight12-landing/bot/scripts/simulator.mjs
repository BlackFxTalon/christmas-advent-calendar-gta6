import { createInterface } from "node:readline";
import { handleUpdate } from "../engine.mjs";

const PLAYER_ID = 1001;
const CHAT_ID = 42;
const TIME_ZONE = "Europe/Moscow";

function createMemoryProgressStore() {
  const rows = new Map();
  const keyFor = (playerId, caseId) => `${playerId}:${caseId}`;

  function rowFor(playerId, caseId) {
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
  }

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
  };
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let progressStore = createMemoryProgressStore();
let now = new Date();
let lastCasePrompt = null;
let buttons = [];
let callbackNumber = 0;

console.log("Локальный симулятор «12 дней до полуночи» — данные живут только в памяти процесса.");
console.log("Примеры: /start, /case 1, /hint 1 1, /progress или ответ на выданное дело.");
console.log("Служебные команды: :button [номер], :buttons, :date ISO, :reset, :quit.");
console.log("Изображения улик не отправляются: симулятор только покажет путь к файлу.");

function showButtons(markup) {
  buttons = (markup?.inline_keyboard ?? []).flat().filter((button) => button.callback_data);
  if (buttons.length) {
    console.log("Кнопки:");
    buttons.forEach((button, index) => console.log(`  ${index + 1}. ${button.text}`));
  }
}

function renderActions(actions) {
  for (const action of actions) {
    if (action.type === "callbackAck") {
      console.log("[нажатие кнопки обработано]");
    } else if (action.type === "message") {
      console.log(`\nБОТ:\n${action.text}\n`);
      if (/ДЕЛО\s*№\s*0?\d{1,2}/iu.test(action.text)) {
        lastCasePrompt = action.text;
      }
      showButtons(action.replyMarkup);
    } else if (action.type === "photo") {
      console.log(`[карточка улики: ${action.filePath}${action.caption ? ` — ${action.caption}` : ""}]`);
    }
  }
}

async function handleMessage(text) {
  const update = {
    message: {
      chat: { id: CHAT_ID, type: "private" },
      from: { id: PLAYER_ID },
      text,
      ...(lastCasePrompt ? { reply_to_message: { text: lastCasePrompt } } : {}),
    },
  };
  const actions = await handleUpdate(update, {
    now,
    timeZone: TIME_ZONE,
    previewMode: true,
    progressStore,
  });
  renderActions(actions);
}

async function handleButton(indexText) {
  if (!buttons.length) {
    console.log("Сейчас нет доступных callback-кнопок. Сначала используйте /start или /case 1.");
    return;
  }
  const index = indexText ? Number(indexText) - 1 : 0;
  if (!Number.isInteger(index) || index < 0 || index >= buttons.length) {
    console.log(`Укажите номер от 1 до ${buttons.length}.`);
    return;
  }
  const button = buttons[index];
  const update = {
    callback_query: {
      id: `sim-${++callbackNumber}`,
      from: { id: PLAYER_ID },
      data: button.callback_data,
      message: { chat: { id: CHAT_ID, type: "private" }, message_id: callbackNumber },
    },
  };
  renderActions(await handleUpdate(update, { now, timeZone: TIME_ZONE, previewMode: true, progressStore }));
}

async function handleInput(rawLine) {
  const line = rawLine.trim();
  if (!line) return true;
  if (line === ":quit" || line === ":q") return false;
  if (line === ":buttons") {
    if (!buttons.length) console.log("Нет доступных кнопок.");
    else buttons.forEach((button, index) => console.log(`${index + 1}. ${button.text}`));
    return true;
  }
  if (line === ":button" || line.startsWith(":button ")) {
    await handleButton(line.slice(7).trim());
    return true;
  }
  if (line === ":reset") {
    progressStore = createMemoryProgressStore();
    lastCasePrompt = null;
    buttons = [];
    console.log("Прогресс в памяти сброшен.");
    return true;
  }
  if (line.startsWith(":date ")) {
    const candidate = new Date(line.slice(6).trim());
    if (Number.isNaN(candidate.getTime())) {
      console.log("Не удалось распознать дату. Пример: :date 2026-12-20T12:00:00Z");
    } else {
      now = candidate;
      console.log(`Дата симуляции: ${now.toISOString()} (календарь: ${TIME_ZONE}).`);
    }
    return true;
  }
  if (line === ":help") {
    console.log("Вводите команды и ответы как в Telegram. После выдачи дела текст автоматически считается ответом на него.");
    console.log(":button [номер] нажимает последнюю показанную кнопку; :date ISO задаёт время для /today; :reset очищает память; :quit завершает симулятор.");
    return true;
  }
  await handleMessage(line);
  return true;
}

try {
  for await (const line of input) {
    const keepGoing = await handleInput(line);
    if (!keepGoing) break;
    process.stdout.write("\nвы> ");
  }
} catch (error) {
  console.error(`Ошибка симулятора: ${error?.message ?? "неизвестная ошибка"}`);
  process.exitCode = 1;
} finally {
  input.close();
}
