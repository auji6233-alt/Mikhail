import path from "node:path";
import dotenv from "dotenv";
import TelegramBot from "node-telegram-bot-api";
import { buildSystemPrompt } from "./systemPrompt.js";
import { getHistory, pushHistory } from "./history.js";
import { askModel } from "./openrouter.js";
import { transcribeVoice } from "./transcribe.js";

// Секреты бота — отдельно от секретов основного приложения (./project/.env).
dotenv.config({ path: path.join(import.meta.dirname, "..", ".env") });

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error(
    "TELEGRAM_BOT_TOKEN не задан. Впишите токен в ./bot_administrator/.env и перезапустите бота."
  );
  process.exit(1);
}
if (!process.env.OPENROUTER_API_KEY) {
  console.error(
    "OPENROUTER_API_KEY не задан. Впишите ключ в ./bot_administrator/.env и перезапустите бота."
  );
  process.exit(1);
}
if (!process.env.ASSEMBLYAI_API_KEY) {
  console.error(
    "ASSEMBLYAI_API_KEY не задан. Впишите ключ в ./bot_administrator/.env и перезапустите бота."
  );
  process.exit(1);
}

// Системная инструкция собирается один раз при старте (role.md + character.md + faq/faq.md).
const systemPrompt = buildSystemPrompt();

// Long polling (обычный HTTP) — не webhook/websocket: на некоторых VPS websocket не работает.
const bot = new TelegramBot(token, { polling: true });

console.log("Бот-администратор запущен (long polling, ответы через OpenRouter)");

/** Общая ветка обработки: и обычный текст, и текст, полученный из расшифровки голосового. */
async function handleUserText(chatId: number, text: string): Promise<void> {
  pushHistory(chatId, { role: "user", content: text });
  try {
    const reply = await askModel(systemPrompt, getHistory(chatId));
    pushHistory(chatId, { role: "assistant", content: reply });
    await bot.sendMessage(chatId, reply);
  } catch (err) {
    console.error("Ошибка при обращении к модели:", err);
    await bot.sendMessage(
      chatId,
      "Сейчас не получается ответить — попробуйте, пожалуйста, чуть позже."
    );
  }
}

bot.on("message", async (msg) => {
  if (!msg.text) return;
  await handleUserText(msg.chat.id, msg.text);
});

bot.on("voice", async (msg) => {
  const chatId = msg.chat.id;
  try {
    const fileUrl = await bot.getFileLink(msg.voice!.file_id);
    const res = await fetch(fileUrl);
    const audio = Buffer.from(await res.arrayBuffer());

    const text = await transcribeVoice(audio);
    console.log(`[voice] расшифровано: "${text}"`);

    await handleUserText(chatId, text);
  } catch (err) {
    console.error("Ошибка расшифровки голосового:", err);
    await bot.sendMessage(
      chatId,
      "Не получилось распознать голосовое сообщение — попробуйте ещё раз или напишите текстом."
    );
  }
});

bot.on("polling_error", (err) => {
  console.error("Ошибка polling:", err.message);
});
