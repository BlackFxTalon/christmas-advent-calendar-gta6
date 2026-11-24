import { CASES, getCaseById } from "./cases.mjs";
import { handleArchiveCommand, handleArchiveCallback } from "./archive.mjs";

const FIRST_DAY = 20;
const LAST_DAY = 31;

const HELP_TEXT = [
  "Команды:",
  "/today — получить дело по календарю адвента",
  "/progress — посмотреть сохранённый прогресс",
  "/archive — архив уже открытых дел и улик",
  "/hint 1 — запросить первую подсказку к делу 1 (или нажать кнопку под делом)",
  "/case 1 — открыть дело вручную только в закрытом тестовом режиме",
  "",
  "Чтобы бот понял ответ, отправь его ответом на сообщение с загадкой.",
  "Дела открываются с 20 по 31 декабря; ответ можно отправить в любой момент.",
].join("\n");

function getDateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));
}

export function getAvailableCaseId(date = new Date(), timeZone = "Europe/Moscow") {
  const { month, day } = getDateParts(date, timeZone);
  if (month !== 12 || day < FIRST_DAY || day > LAST_DAY) return null;
  const caseId = day - (FIRST_DAY - 1);
  return caseId >= 1 && caseId <= CASES.length ? caseId : null;
}

export function normalizeAnswer(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .replace(/[^a-zа-я0-9]/giu, "");
}

// Strict clock parser: accepts 23:46, 23:46:00 or "в 23:46".
// With allowSeconds=false only чч:мм is accepted (case 08 requires it).
// Returns seconds since midnight or null when the format does not match.
export function parseClock(text, { allowSeconds = true } = {}) {
  const match = String(text ?? "")
    .normalize("NFKC")
    .trim()
    .match(/^(?:в\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?$/iu);
  if (!match) return null;
  if (!allowSeconds && match[3] != null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

export function parseMoment(text) {
  const match = String(text ?? "")
    .normalize("NFKC")
    .trim()
    .match(/^(?:(\d{1,2})\s+декабря[,\s]*(?:в\s*)?)?(?:в\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?$/iu);
  if (!match) return null;
  const day = match[1] ? Number(match[1]) : null;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  const seconds = Number(match[4] ?? 0);
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  if (day != null && (day < 1 || day > 31)) return null;
  return { day, seconds: hours * 3600 + minutes * 60 + seconds };
}

function acceptedClocks(item) {
  return [...new Set((item.answers ?? []).map(parseClock).filter((value) => value != null))];
}

function acceptedMoments(item) {
  return [...new Set((item.answers ?? []).map(parseMoment).filter(Boolean).map((value) => value.seconds))];
}

function normalizeMoney(text) {
  const digits = String(text ?? "").replace(/[^\d]/gu, "");
  return digits === "" ? null : digits.replace(/^0+(?=\d)/u, "");
}

function defaultFormatError(item) {
  if (item.answerType === "clock") return "Нужен строгий формат чч:мм, например 23:46. Такая попытка не засчитана.";
  if (item.answerType === "moment") return "Укажи дату и время, например 20 декабря, 11:48:12, или хотя бы время 11:48.";
  return "Не удалось разобрать ответ. Проверь формат и попробуй снова.";
}

// Returns { status, message, correct } where status is
// correct | incorrect | trap | invalid. Invalid answers are not recorded
// as attempts, so a formatting mistake never worsens player progress.
export function evaluateAnswer(caseId, answer) {
  const item = typeof caseId === "object" && caseId !== null ? caseId : getCaseById(caseId);
  if (!item) return { status: "incorrect", correct: false, message: "Это дело ещё не подключено к боту." };
  const raw = String(answer ?? "").trim();

  if (item.answerType === "clock") {
    const allowSeconds = item.timeFormat !== "HH:MM";
    const parsed = parseClock(raw, { allowSeconds });
    if (parsed == null) {
      return { status: "invalid", correct: false, message: item.formatError ?? defaultFormatError(item) };
    }
    const trap = item.traps
      ? Object.entries(item.traps).find(([key]) => parseClock(key, { allowSeconds }) === parsed)
      : null;
    if (trap) return { status: "trap", correct: false, message: trap[1] };
    if (acceptedClocks(item).includes(parsed)) return { status: "correct", correct: true, message: item.correct };
    return { status: "incorrect", correct: false, message: item.incorrect };
  }

  if (item.answerType === "moment") {
    const parsed = parseMoment(raw);
    if (parsed == null) {
      return { status: "invalid", correct: false, message: item.formatError ?? defaultFormatError(item) };
    }
    const trap = item.traps ? Object.entries(item.traps).find(([key]) => parseMoment(key)?.seconds === parsed.seconds) : null;
    if (trap) return { status: "trap", correct: false, message: trap[1] };
    const dayMatches = parsed.day == null || parsed.day === 20;
    if (dayMatches && acceptedMoments(item).includes(parsed.seconds)) {
      return { status: "correct", correct: true, message: item.correct };
    }
    return { status: "incorrect", correct: false, message: item.incorrect };
  }

  if (item.answerType === "money") {
    const normalized = normalizeMoney(raw);
    if (normalized == null) {
      return { status: "invalid", correct: false, message: item.formatError ?? "Назови сумму числом, например 4000." };
    }
    if ((item.answers ?? []).some((candidate) => normalizeMoney(candidate) === normalized)) {
      return { status: "correct", correct: true, message: item.correct };
    }
    return { status: "incorrect", correct: false, message: item.incorrect };
  }

  const normalized = normalizeAnswer(raw);
  if (normalized === "") {
    return { status: "invalid", correct: false, message: item.formatError ?? defaultFormatError(item) };
  }
  const matched = (item.answers ?? []).some((candidate) => normalizeAnswer(candidate) === normalized);
  return matched
    ? { status: "correct", correct: true, message: item.correct }
    : { status: "incorrect", correct: false, message: item.incorrect };
}

export function isCorrectAnswer(caseId, answer) {
  return evaluateAnswer(caseId, answer).status === "correct";
}

function getPlayerId(update) {
  const id = update?.message?.from?.id ?? update?.callback_query?.from?.id;
  return id == null ? null : String(id);
}

function parseCaseId(text) {
  const match = String(text ?? "").match(/ДЕЛО\s*№\s*0?(\d{1,2})/iu);
  return match ? Number(match[1]) : null;
}

function hintKeyboard(caseId, nextStep) {
  if (nextStep > 3) return undefined;
  return {
    inline_keyboard: [[{
      text: `Подсказка ${nextStep} из 3`,
      callback_data: `hint:${caseId}:${nextStep}`,
    }]],
  };
}

function caseMessage(item) {
  return [
    `ВЕРДЕ-БЕЙ · ДЕЛО № ${String(item.id).padStart(2, "0")} / ${item.title.toLocaleUpperCase("ru-RU")}`,
    "",
    item.prompt,
    "",
    item.materials,
    "",
    "Ответь на это сообщение, чтобы бот понял, к какому делу относится решение.",
  ].join("\n");
}

async function issueCase(chatId, playerId, item, progressStore) {
  await progressStore.markCaseIssued(playerId, item.id);
  const actions = [
    {
      type: "message",
      chatId,
      text: caseMessage(item),
      replyMarkup: { inline_keyboard: [[{ text: "Подсказка 1 из 3", callback_data: `hint:${item.id}:1` }]] },
    },
  ];
  if (item.card) {
    actions.push({
      type: "photo",
      chatId,
      filePath: item.card,
      caption: `Улики к делу №${String(item.id).padStart(2, "0")}`,
    });
  }
  return actions;
}

function chatMessage(chatId, text, replyMarkup) {
  return [{ type: "message", chatId, text, ...(replyMarkup ? { replyMarkup } : {}) }];
}

function missingPlayerMessage(chatId) {
  return chatMessage(chatId, "Не удалось определить Telegram-пользователя. Открой бота в личном чате и повтори действие.");
}

async function issueToday(chatId, playerId, now, timeZone, progressStore) {
  const id = getAvailableCaseId(now, timeZone);
  if (!id) {
    return chatMessage(
      chatId,
      "Календарь адвента открыт с 20 по 31 декабря. Сегодня новое дело не выдаётся. В закрытом тестовом режиме любое дело можно открыть командой /case N.",
    );
  }
  return issueCase(chatId, playerId, getCaseById(id), progressStore);
}

function formatProgress(rows) {
  const byCase = new Map(rows.map((row) => [Number(row.case_id), row]));
  const solved = rows.filter((row) => row.status === "completed").length;
  const lines = CASES.map((item) => {
    const row = byCase.get(item.id);
    const number = String(item.id).padStart(2, "0");
    if (!row) return `${number}. ${item.title} — ещё не начато`;
    const status = row.status === "completed" ? "решено" : "в работе";
    return `${number}. ${item.title} — ${status}; попыток: ${row.attempts_count}; подсказок: ${row.hints_used}`;
  });
  return [
    "ТВОЙ ПРОГРЕСС",
    `Решено: ${solved} из ${CASES.length}.`,
    "",
    ...lines,
  ].join("\n");
}

async function handleCallback(update, options) {
  const query = update.callback_query;
  const chatId = query.message?.chat?.id;
  if (chatId == null) return [];
  const ack = { type: "callbackAck", callbackQueryId: query.id };
  const playerId = getPlayerId(update);

  if (query.data === "today") {
    if (!playerId) return [ack, ...missingPlayerMessage(chatId)];
    return [ack, ...await issueToday(chatId, playerId, options.now, options.timeZone, options.progressStore)];
  }
  if (query.data === "help") return [ack, ...chatMessage(chatId, HELP_TEXT)];
  if (String(query.data ?? "").startsWith("ar:")) {
    return handleArchiveCallback(query, {
      cases: CASES,
      progressStore: options.progressStore,
      evidenceStore: options.progressStore,
    });
  }

  const match = String(query.data ?? "").match(/^hint:(\d+):(\d+)$/u);
  if (!match) return [ack];
  const item = getCaseById(match[1]);
  const step = Number(match[2]);
  if (!item || step < 1 || step > 3) return [ack, ...chatMessage(chatId, "Эта подсказка недоступна.")];
  if (!playerId) return [ack, ...missingPlayerMessage(chatId)];

  await options.progressStore.recordHint(playerId, item.id, step);
  const text = `Подсказка ${step} из 3 · дело №${String(item.id).padStart(2, "0")}\n\n${item.hints[step - 1]}`;
  const markup = step < 3 ? hintKeyboard(item.id, step + 1) : undefined;
  return [ack, ...chatMessage(chatId, text, markup)];
}

export async function handleUpdate(update, {
  now = new Date(),
  timeZone = "Europe/Moscow",
  previewMode = false,
  progressStore,
} = {}) {
  if (!progressStore) throw new Error("A progressStore is required.");
  if (update?.callback_query) return handleCallback(update, { now, timeZone, progressStore });

  const message = update?.message;
  if (!message || message.chat?.id == null || typeof message.text !== "string") return [];

  const chatId = message.chat.id;
  const playerId = getPlayerId(update);
  const text = message.text.trim();
  const command = text.match(/^\/(start|help|today|progress|archive|case|hint)(?:@\w+)?(?:\s+(.*))?$/iu);
  const name = command?.[1]?.toLocaleLowerCase("ru-RU");
  const args = (command?.[2] ?? "").trim();

  if (name === "start") {
    const keyboard = { inline_keyboard: [[{ text: "Получить дело на сегодня", callback_data: "today" }], [{ text: "Архив улик", callback_data: "ar:l:all:0" }], [{ text: "Как играть", callback_data: "help" }]] };
    return chatMessage(chatId, "Детектив «12 дней до полуночи»\n\nКаждый день — новая улика. Решай загадку сообщением-ответом; если застрял, используй кнопку подсказки. Прогресс сохраняется автоматически.", keyboard);
  }
  if (name === "help") return chatMessage(chatId, HELP_TEXT);

  if (name === "progress") {
    if (message.chat.type !== "private") {
      return chatMessage(chatId, "Для приватности прогресс можно посмотреть только в личном чате с ботом.");
    }
    if (!playerId) return missingPlayerMessage(chatId);
    return chatMessage(chatId, formatProgress(await progressStore.getProgress(playerId)));
  }

  if (name === "archive") {
    return handleArchiveCommand(message, { cases: CASES, progressStore });
  }

  if (name === "today") {
    if (!playerId) return missingPlayerMessage(chatId);
    return issueToday(chatId, playerId, now, timeZone, progressStore);
  }

  if (name === "case") {
    const id = Number(args);
    if (!previewMode) return chatMessage(chatId, "Ручная выдача дел выключена. Используй /today — календарь сам откроет доступное дело.");
    const item = getCaseById(id);
    if (!item) return chatMessage(chatId, `В пакете доступны дела с 1 по ${CASES.length}.`);
    if (!playerId) return missingPlayerMessage(chatId);
    return issueCase(chatId, playerId, item, progressStore);
  }

  if (name === "hint") {
    const replyCaseId = parseCaseId(message.reply_to_message?.text);
    const parsedArgs = args.match(/^(\d{1,2})(?:\s+(\d))?$/u);
    const id = replyCaseId ?? (parsedArgs ? Number(parsedArgs[1]) : null);
    const step = parsedArgs?.[2] ? Number(parsedArgs[2]) : 1;
    const item = getCaseById(id);
    if (!item || step < 1 || step > 3) return chatMessage(chatId, `Укажи номер дела от 1 до ${CASES.length}: /hint 1, /hint 2 или /hint 3.`);
    if (!playerId) return missingPlayerMessage(chatId);
    await progressStore.recordHint(playerId, item.id, step);
    const markup = step < 3 ? hintKeyboard(item.id, step + 1) : undefined;
    return chatMessage(chatId, `Подсказка ${step} из 3 · дело №${String(item.id).padStart(2, "0")}\n\n${item.hints[step - 1]}`, markup);
  }

  const replyCaseId = parseCaseId(message.reply_to_message?.text);
  if (!replyCaseId) {
    return chatMessage(chatId, "Чтобы я понял, к какому делу относится ответ, ответь на сообщение с загадкой. Команды: /today, /progress, /help.");
  }
  const item = getCaseById(replyCaseId);
  if (!item) return chatMessage(chatId, "Это дело ещё не подключено к боту.");
  if (!playerId) return missingPlayerMessage(chatId);

  const result = evaluateAnswer(item, text);
  if (result.status === "invalid") return chatMessage(chatId, result.message);
  await progressStore.recordAttempt(playerId, item.id, result.correct);
  return chatMessage(chatId, result.message);
}

export { CASES, formatProgress };
