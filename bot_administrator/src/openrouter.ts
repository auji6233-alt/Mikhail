import type { ChatMessage } from "./history.js";
import { toolSchemas, callTool } from "./tools.js";
import { ExternalServiceError, classifyHttpStatus, classifyNetworkError } from "./errors.js";

const MODEL = "google/gemini-2.5-flash";
const MAX_TOOL_ROUNDS = 5;
const REQUEST_TIMEOUT_MS = 25_000;

/** Читается лениво (не на верхнем уровне модуля) — на момент импорта .env ещё не загружен. */
function chatCompletionsUrl(): string {
  const base = process.env.OPENROUTER_BASE_URL;
  if (!base) throw new Error("OPENROUTER_BASE_URL не задан в ./bot_administrator/.env");
  return `${base.replace(/\/$/, "")}/chat/completions`;
}

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type OpenRouterMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

type OpenRouterResponse = {
  choices?: { message?: OpenRouterMessage }[];
};

async function requestCompletion(messages: OpenRouterMessage[]): Promise<OpenRouterMessage> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY не задан в ./bot_administrator/.env");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(chatCompletionsUrl(), {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        tools: toolSchemas,
        tool_choice: "auto",
        // Низкая температура — это не творческий чат, а бот, который не должен выдумывать
        // расписание/факты вместо того, чтобы дёрнуть нужный инструмент.
        temperature: 0.2,
      }),
    });
  } catch (err) {
    throw new ExternalServiceError(classifyNetworkError(err), "Не удалось связаться с OpenRouter", {
      cause: err,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new ExternalServiceError(
      classifyHttpStatus(res.status),
      `OpenRouter вернул ошибку ${res.status}: ${errorText}`
    );
  }

  const data = (await res.json().catch(() => null)) as OpenRouterResponse | null;
  const message = data?.choices?.[0]?.message;
  if (!message) {
    throw new ExternalServiceError("unknown", "OpenRouter не вернул сообщение");
  }
  return message;
}

/**
 * Ответ модели через OpenRouter с поддержкой tool-use: модель сама решает,
 * ответить по базе знаний (FAQ) или вызвать инструмент (/api/bot/*) и выполнить действие.
 * Цикл продолжается, пока модель не даст финальный текстовый ответ (без tool_calls).
 */
export async function askModel(systemPrompt: string, history: ChatMessage[]): Promise<string> {
  const messages: OpenRouterMessage[] = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const message = await requestCompletion(messages);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      const reply = message.content?.trim();
      if (!reply) throw new ExternalServiceError("unknown", "OpenRouter не вернул текст ответа");
      return reply;
    }

    messages.push({ role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls });

    for (const call of message.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        // некорректный JSON от модели — передадим инструменту пустые аргументы, он сам вернёт ошибку валидации
      }
      const result = await callTool(call.function.name, args);
      console.log(`[tool] ${call.function.name}(${JSON.stringify(args)}) →`, JSON.stringify(result));
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  throw new ExternalServiceError("unknown", "Превышен лимит обращений к инструментам за один ответ");
}
