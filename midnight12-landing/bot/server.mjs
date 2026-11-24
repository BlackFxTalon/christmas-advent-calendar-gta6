import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { handleUpdate } from "./engine.mjs";
import { createPostgresProgressStore } from "./progress-store.mjs";

const botDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(botDir, "..");
const maxBodyBytes = 1024 * 1024;

function constantTimeEqual(actual, expected) {
  if (typeof actual !== "string" || typeof expected !== "string") return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function callTelegram(method, payload, token) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) {
    throw new Error(`Telegram ${method} failed (${response.status})`);
  }
  return result;
}

async function sendPhoto(action, token) {
  const filePath = resolve(projectRoot, action.filePath);
  const fileBytes = await readFile(filePath);
  const form = new FormData();
  form.append("chat_id", String(action.chatId));
  form.append("photo", new Blob([fileBytes], { type: "image/png" }), basename(filePath));
  if (action.caption) form.append("caption", action.caption);
  const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(20_000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error(`Telegram sendPhoto failed (${response.status})`);
  return result;
}

async function dispatch(actions, token) {
  for (const action of actions) {
    if (action.type === "callbackAck") {
      await callTelegram("answerCallbackQuery", { callback_query_id: action.callbackQueryId }, token);
    } else if (action.type === "photo") {
      await sendPhoto(action, token);
    } else if (action.type === "message") {
      await callTelegram("sendMessage", {
        chat_id: action.chatId,
        text: action.text,
        ...(action.replyMarkup ? { reply_markup: action.replyMarkup } : {}),
        disable_web_page_preview: true,
      }, token);
    }
  }
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

export function createBotServer({
  token = process.env.TELEGRAM_BOT_TOKEN,
  webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET,
  previewMode = process.env.BOT_PREVIEW_MODE === "1",
  timeZone = process.env.BOT_TIME_ZONE || "Europe/Moscow",
  progressStore,
} = {}) {
  if (!token) throw new Error("Set TELEGRAM_BOT_TOKEN in the server environment.");
  if (!webhookSecret || !/^[A-Za-z0-9_-]{1,256}$/u.test(webhookSecret)) {
    throw new Error("Set TELEGRAM_WEBHOOK_SECRET (1–256 characters: letters, digits, _ or -).");
  }
  const store = progressStore ?? createPostgresProgressStore();

  return createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (request.method === "GET" && pathname === "/health") {
      return sendJson(response, 200, { ok: true, service: "12-days-telegram-bot" });
    }
    if (request.method !== "POST" || pathname !== "/telegram/webhook") {
      return sendJson(response, 404, { ok: false, error: "not_found" });
    }
    if (!constantTimeEqual(request.headers["x-telegram-bot-api-secret-token"], webhookSecret)) {
      return sendJson(response, 403, { ok: false, error: "forbidden" });
    }

    try {
      const update = await readJsonBody(request);
      const actions = await handleUpdate(update, { previewMode, timeZone, progressStore: store });
      await dispatch(actions, token);
      return sendJson(response, 200, { ok: true });
    } catch (error) {
      const status = error instanceof SyntaxError ? 400 : 500;
      console.error(`Webhook processing failed (${error?.code ?? error?.name ?? "Error"}).`);
      return sendJson(response, status, { ok: false, error: status === 400 ? "invalid_json" : "processing_failed" });
    }
  });
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const progressStore = createPostgresProgressStore();
  const server = createBotServer({ progressStore });
  const port = Number(process.env.PORT || 8080);
  server.listen(port, "0.0.0.0", () => {
    console.log(`Telegram webhook adapter listening on port ${port}`);
  });

  const shutdown = () => {
    server.close(() => {
      progressStore.close().catch(() => { process.exitCode = 1; });
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
