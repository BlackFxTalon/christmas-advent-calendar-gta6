import { CASES, getCaseById } from "./cases.mjs";

const HELP_TEXT = [
  "Команды:",
  "/today — получить дело по календарю адвента",
  "/progress — посмотреть сохранённый прогресс",
  "/hint 1 — запросить первую подсказку к делу 1 (или нажать кнопку под делом)",
  "/case 1 — открыть дело вручную только в закрытом тестовом режиме",
  "",
  "Чтобы бот понял ответ, отправь его ответом на сообщение с загадкой.",
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
  if (month !== 12 || day < 20 || day > 22) return null;
  return day - 19;
}

export function normalizeAnswer(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .replace(/[^a-zа-я0-9]/giu, "");
}

export function isCorrectAnswer(caseId, answer) {
  const item = getCaseById(caseId);
  if (!item) return false;
  const normalized = normalizeAnswer(answer);
  return item.answers.some((candidate) => normalizeAnswer(candidate) === normalized);
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
  return [
    {
      type: "message",
      chatId,
      text: caseMessage(item),
      replyMarkup: { inline_keyboard: [[{ text: "Подсказка 1 из 3", callback_data: `hint:${item.id}:1` }]] },
    },
    {
      type: "photo",
      chatId,
      filePath: item.card,
      caption: `Улики к делу №${String(item.id).padStart(2, "0")}`,
    },
  ];
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
      "В этом тестовом боте подключены первые три дела: 20, 21 и 22 декабря. Для проверки вне календаря используйте /case 1 в закрытом тестовом режиме.",
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
  const command = text.match(/^\/(start|help|today|progress|case|hint)(?:@\w+)?(?:\s+(.*))?$/iu);
  const name = command?.[1]?.toLocaleLowerCase("ru-RU");
  const args = (command?.[2] ?? "").trim();

  if (name === "start") {
    const keyboard = { inline_keyboard: [[{ text: "Получить дело на сегодня", callback_data: "today" }], [{ text: "Как играть", callback_data: "help" }]] };
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

  if (name === "today") {
    if (!playerId) return missingPlayerMessage(chatId);
    return issueToday(chatId, playerId, now, timeZone, progressStore);
  }

  if (name === "case") {
    const id = Number(args);
    if (!previewMode) return chatMessage(chatId, "Ручная выдача дел выключена. Используй /today — календарь сам откроет доступное дело.");
    const item = getCaseById(id);
    if (!item) return chatMessage(chatId, "В тестовом пакете доступны дела 1, 2 и 3.");
    if (!playerId) return missingPlayerMessage(chatId);
    return issueCase(chatId, playerId, item, progressStore);
  }

  if (name === "hint") {
    const replyCaseId = parseCaseId(message.reply_to_message?.text);
    const parsedArgs = args.match(/^(\d{1,2})(?:\s+(\d))?$/u);
    const id = replyCaseId ?? (parsedArgs ? Number(parsedArgs[1]) : null);
    const step = parsedArgs?.[2] ? Number(parsedArgs[2]) : 1;
    const item = getCaseById(id);
    if (!item || step < 1 || step > 3) return chatMessage(chatId, "Укажи номер тестового дела: /hint 1, /hint 2 или /hint 3.");
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
  if (!item) return chatMessage(chatId, "Это дело ещё не подключено к тестовому боту.");
  if (!playerId) return missingPlayerMessage(chatId);

  const correct = isCorrectAnswer(item.id, text);
  await progressStore.recordAttempt(playerId, item.id, correct);
  return chatMessage(chatId, correct ? item.correct : item.incorrect);
}

export { CASES, formatProgress };
