// Прототип архива улик для текущего стека бота: node:http + чистый движок + pg.
// Telegraf не нужен: модуль, как и engine.mjs, принимает update и возвращает массив actions,
// а server.mjs исполняет их. Поэтому сохраняются идемпотентность по update_id и транзакция БД.
//
// Модуль подключён к engine.mjs; архитектурные детали описаны в ../docs/archive-architecture.md.

export const ARCHIVE_PAGE_SIZE = 6;
const VIEWS = ["all", "open", "solved"];
const VIEW_LABELS = { all: "Все", open: "В работе", solved: "Решённые" };

const pad = (id) => String(id).padStart(2, "0");

// callback_data в Telegram ограничен 64 байтами, поэтому формат короткий:
//   ar:l:<view>:<page>                      — список дел
//   ar:c:<caseId>:<view>:<page>             — карточка дела
//   ar:e:<caseId>:<evidenceId>:<view>:<page> — конкретная улика
// view/page переносятся во все кнопки, чтобы «Назад» возвращал в тот же фильтр и страницу.
export function parseArchiveCallback(data) {
  const s = String(data ?? "");
  let m = s.match(/^ar:l:(all|open|solved):(\d{1,2})$/u);
  if (m) return { action: "list", view: m[1], page: Number(m[2]) };
  m = s.match(/^ar:c:(\d{1,2}):(all|open|solved):(\d{1,2})$/u);
  if (m) return { action: "case", caseId: Number(m[1]), view: m[2], page: Number(m[3]) };
  m = s.match(/^ar:e:(\d{1,2}):([a-z0-9-]{1,24}):(all|open|solved):(\d{1,2})$/u);
  if (m) return { action: "evidence", caseId: Number(m[1]), evidenceId: m[2], view: m[3], page: Number(m[4]) };
  return null;
}

const cb = {
  list: (view, page) => `ar:l:${view}:${page}`,
  case: (caseId, view, page) => `ar:c:${caseId}:${view}:${page}`,
  evidence: (caseId, evidenceId, view, page) => `ar:e:${caseId}:${evidenceId}:${view}:${page}`,
};

// Статус дела берётся только из bot_case_progress: нет строки — дело закрыто и в архиве не видно.
// Сама кнопка архива статус не меняет: «решено» выставляет движок после правильного ответа.
export function caseStatus(row) {
  if (!row) return "locked";
  return row.status === "completed" ? "solved" : "open";
}

function rowsByCase(progressRows) {
  return new Map((progressRows ?? []).map((row) => [Number(row.case_id), row]));
}

export function buildArchiveList({ cases, progressRows, view = "all", page = 0, pageSize = ARCHIVE_PAGE_SIZE }) {
  const safeView = VIEWS.includes(view) ? view : "all";
  const rows = rowsByCase(progressRows);
  const unlocked = cases.filter((item) => caseStatus(rows.get(item.id)) !== "locked");
  const filtered = unlocked.filter((item) => {
    const status = caseStatus(rows.get(item.id));
    return safeView === "all" || status === safeView;
  });

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(Math.max(0, Number(page) || 0), pageCount - 1);
  const visible = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize);
  const solvedCount = unlocked.filter((item) => caseStatus(rows.get(item.id)) === "solved").length;

  const lines = visible.map((item) => {
    const status = caseStatus(rows.get(item.id));
    const mark = status === "solved" ? "✓ решено" : "• в работе";
    return `Дело ${pad(item.id)} · ${item.title} — ${mark}`;
  });

  const text = [
    "АРХИВ РАССЛЕДОВАНИЯ",
    `Открыто дел: ${unlocked.length} из ${cases.length} · решено: ${solvedCount}`,
    `Фильтр: ${VIEW_LABELS[safeView]}${pageCount > 1 ? ` · стр. ${safePage + 1}/${pageCount}` : ""}`,
    "",
    ...(lines.length ? lines : [unlocked.length ? "В этом фильтре дел нет." : "Архив пуст. Получи первое дело командой /today."]),
  ].join("\n");

  const keyboard = [];
  for (let i = 0; i < visible.length; i += 2) {
    keyboard.push(visible.slice(i, i + 2).map((item) => ({
      text: `${caseStatus(rows.get(item.id)) === "solved" ? "✓" : "•"} ${pad(item.id)}`,
      callback_data: cb.case(item.id, safeView, safePage),
    })));
  }
  if (pageCount > 1) {
    const nav = [];
    if (safePage > 0) nav.push({ text: "← Назад", callback_data: cb.list(safeView, safePage - 1) });
    if (safePage < pageCount - 1) nav.push({ text: "Дальше →", callback_data: cb.list(safeView, safePage + 1) });
    keyboard.push(nav);
  }
  keyboard.push(VIEWS.map((v) => ({
    text: v === safeView ? `[${VIEW_LABELS[v]}]` : VIEW_LABELS[v],
    callback_data: cb.list(v, 0),
  })));

  return { text, replyMarkup: { inline_keyboard: keyboard } };
}

export function buildCaseView({ item, row, viewed = new Set(), view = "all", page = 0 }) {
  const status = caseStatus(row);
  if (status === "locked") return null;

  const evidence = item.evidence ?? [];
  const lines = evidence.map((ev, index) => {
    const seen = viewed.has(`${item.id}:${ev.id}`);
    return `${index + 1}. ${ev.title}${seen ? "" : " · новое"}`;
  });

  const text = [
    `ДЕЛО ${pad(item.id)} · ${item.title.toLocaleUpperCase("ru-RU")}`,
    status === "solved" ? "Статус: решено" : "Статус: в работе",
    "",
    "Материалы:",
    ...(lines.length ? lines : ["Для этого дела нет отдельных материалов."]),
    // Для решённого дела показываем итог, чтобы игрок мог восстановить цепочку к финалу.
    // Ответы и подсказки в архиве не выводятся: подсказки остаются в кнопках под самим делом.
    ...(status === "solved" && item.summary ? ["", `Итог: ${item.summary}`] : []),
  ].join("\n");

  const keyboard = evidence.map((ev) => [{
    text: ev.title,
    callback_data: cb.evidence(item.id, ev.id, view, page),
  }]);
  keyboard.push([{ text: "← К списку дел", callback_data: cb.list(view, page) }]);
  return { text, replyMarkup: { inline_keyboard: keyboard } };
}

function evidenceActions({ chatId, item, ev, view, page }) {
  const back = { inline_keyboard: [[{ text: `← К делу ${pad(item.id)}`, callback_data: cb.case(item.id, view, page) }]] };
  const header = `Дело ${pad(item.id)} · ${ev.title}`;
  if (ev.card) {
    // Подпись к фото ограничена 1024 символами; длинный текст улики уходит отдельным сообщением.
    const caption = ev.text && `${header}\n\n${ev.text}`.length <= 1024 ? `${header}\n\n${ev.text}` : header;
    const actions = [{ type: "photo", chatId, filePath: ev.card, caption, replyMarkup: back }];
    if (caption === header && ev.text) actions.push({ type: "message", chatId, text: ev.text });
    return actions;
  }
  return [{ type: "message", chatId, text: `${header}\n\n${ev.text}`, replyMarkup: back }];
}

// Команда /archive: новое сообщение со списком. Только личный чат — как и /progress.
export async function handleArchiveCommand(message, { cases, progressStore }) {
  const chatId = message.chat.id;
  if (message.chat.type !== "private") {
    return [{ type: "message", chatId, text: "Архив улик доступен только в личном чате с ботом." }];
  }
  const playerId = String(message.from?.id ?? "");
  if (!playerId) return [{ type: "message", chatId, text: "Не удалось определить игрока." }];
  const list = buildArchiveList({ cases, progressRows: await progressStore.getProgress(playerId) });
  return [{ type: "message", chatId, text: list.text, replyMarkup: list.replyMarkup }];
}

// Нажатия кнопок архива. Навигация редактирует то же сообщение (editMessage), чтобы чат
// не засорялся; улика отправляется новым сообщением, чтобы её можно было найти и переслать.
export async function handleArchiveCallback(query, { cases, progressStore, evidenceStore }) {
  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;
  const ack = { type: "callbackAck", callbackQueryId: query.id };
  const parsed = parseArchiveCallback(query.data);
  if (chatId == null || !parsed) return [ack];
  const playerId = String(query.from?.id ?? "");
  if (!playerId) return [ack];

  // callback_data приходит от клиента и не является доказательством доступа:
  // доступ всегда перепроверяется по сохранённому прогрессу.
  const progressRows = await progressStore.getProgress(playerId);
  const rows = rowsByCase(progressRows);
  const edit = (view) => ({ type: "editMessage", chatId, messageId, text: view.text, replyMarkup: view.replyMarkup });

  if (parsed.action === "list") {
    return [ack, edit(buildArchiveList({ cases, progressRows, view: parsed.view, page: parsed.page }))];
  }

  const item = cases.find((c) => c.id === parsed.caseId);
  const row = item ? rows.get(item.id) : undefined;
  if (!item || caseStatus(row) === "locked") {
    return [{ ...ack, text: "Это дело ещё не открыто." }];
  }

  if (parsed.action === "case") {
    const viewed = evidenceStore ? await evidenceStore.getViewed(playerId) : new Set();
    return [ack, edit(buildCaseView({ item, row, viewed, view: parsed.view, page: parsed.page }))];
  }

  const ev = (item.evidence ?? []).find((e) => e.id === parsed.evidenceId);
  if (!ev) return [{ ...ack, text: "Улика не найдена." }];
  if (evidenceStore) await evidenceStore.markViewed(playerId, item.id, ev.id);
  return [ack, ...evidenceActions({ chatId, item, ev, view: parsed.view, page: parsed.page })];
}
