import type { ChatMessage } from "./history.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

type OpenRouterResponse = {
  choices?: { message?: { content?: string } }[];
};

/** Ответ модели через OpenRouter (OpenAI-совместимый chat/completions). */
export async function askModel(
  systemPrompt: string,
  history: ChatMessage[]
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY не задан в ./bot_administrator/.env");
  }

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "system", content: systemPrompt }, ...history],
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`OpenRouter вернул ошибку ${res.status}: ${errorText}`);
  }

  const data = (await res.json()) as OpenRouterResponse;
  const reply = data.choices?.[0]?.message?.content?.trim();
  if (!reply) {
    throw new Error("OpenRouter не вернул текст ответа");
  }
  return reply;
}
