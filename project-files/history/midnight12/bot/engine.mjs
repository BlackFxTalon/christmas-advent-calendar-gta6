import { CASES, getCaseById } from "./cases.mjs";

const HELP_TEXT = [
  "Команды:",
  "/today — получить дело по календарю адвента",
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

function issueCase(chatId, item) {
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

function issueToday(chatId, now, timeZone) {
  const id = getAvailableCaseId(now, timeZone);
  if (!id) {
    return chatMessage(
      chatId,
      "В этом тестовом боте подключены первые три дела: 20, 21 и 22 декабря. Для проверки вне календаря используйте /case 1 в закрытом тестовом режиме.",
    );
  }
  return issueCase(chatId, getCaseById(id));
}

function handleCallback(update, options) {
  const query = update.callback_query;
  const chatId = query.message?.chat?.id;
  if (chatId == null) return [];
  const ack = { type: "callbackAck", callbackQueryId: query.id };
  if (query.data === "today") return [ack, ...issueToday(chatId, options.now, options.timeZone)];
  if (query.data === "help") return [ack, ...chatMessage(chatId, HELP_TEXT)];

  const match = String(query.data ?? "").match(/^hint:(\d+):(\d+)$/u);
  if (!match) return [ack];
  const item = getCaseById(match[1]);
  const step = Number(match[2]);
  if (!item || step < 1 || step > 3) return [ack, ...chatMessage(chatId, "Эта подсказка недоступна.")];
  const text = `Подсказка ${step} из 3 · дело №${String(item.id).padStart(2, "0")}\n\n${item.hints[step - 1]}`;
  const markup = step < 3 ? hintKeyboard(item.id, step + 1) : undefined;
  return [ack, ...chatMessage(chatId, text, markup)];
}

export function handleUpdate(update, {
  now = new Date(),
  timeZone = "Europe/Moscow",
  previewMode = false,
} = {}) {
  if (update?.callback_query) return handleCallback(update, { now, timeZone });
  const message = update?.message;
  if (!message || message.chat?.id == null || typeof message.text !== "string") return [];

  const chatId = message.chat.id;
  const text = message.text.trim();
  const command = text.match(/^\/(start|help|today|case|hint)(?:@\w+)?(?:\s+(.*))?$/iu);
  const name = command?.[1]?.toLocaleLowerCase("ru-RU");
  const args = (command?.[2] ?? "").trim();

  if (name === "start") {
    const keyboard = { inline_keyboard: [[{ text: "Получить дело на сегодня", callback_data: "today" }], [{ text: "Как играть", callback_data: "help" }]] };
    return chatMessage(chatId, "Детектив «12 дней до полуночи»\n\nКаждый день — новая улика. Решай загадку сообщением-ответом; если застрял, используй кнопку подсказки.", keyboard);
  }
  if (name === "help") return chatMessage(chatId, HELP_TEXT);
  if (name === "today") return issueToday(chatId, now, timeZone);

  if (name === "case") {
    const id = Number(args);
    if (!previewMode) return chatMessage(chatId, "Ручная выдача дел выключена. Используй /today — календарь сам откроет доступное дело.");
    const item = getCaseById(id);
    return item ? issueCase(chatId, item) : chatMessage(chatId, "В тестовом пакете доступны дела 1, 2 и 3.");
  }

  if (name === "hint") {
    const replyCaseId = parseCaseId(message.reply_to_message?.text);
    const parsedArgs = args.match(/^(\d{1,2})(?:\s+(\d))?$/u);
    const id = replyCaseId ?? (parsedArgs ? Number(parsedArgs[1]) : null);
    const step = parsedArgs?.[2] ? Number(parsedArgs[2]) : 1;
    const item = getCaseById(id);
    if (!item || step < 1 || step > 3) return chatMessage(chatId, "Укажи номер тестового дела: /hint 1, /hint 2 или /hint 3.");
    const markup = step < 3 ? hintKeyboard(item.id, step + 1) : undefined;
    return chatMessage(chatId, `Подсказка ${step} из 3 · дело №${String(item.id).padStart(2, "0")}\n\n${item.hints[step - 1]}`, markup);
  }

  const replyCaseId = parseCaseId(message.reply_to_message?.text);
  if (!replyCaseId) {
    return chatMessage(chatId, "Чтобы я понял, к какому делу относится ответ, ответь на сообщение с загадкой. Команды: /today, /help.");
  }
  const item = getCaseById(replyCaseId);
  if (!item) return chatMessage(chatId, "Это дело ещё не подключено к тестовому боту.");
  return chatMessage(chatId, isCorrectAnswer(item.id, text) ? item.correct : item.incorrect);
}

export { CASES };
