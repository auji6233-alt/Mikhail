import { ExternalServiceError, classifySdkError } from "./errors.js";

const MODEL = "google/gemini-2.5-flash";
const REQUEST_TIMEOUT_MS = 90_000;

const SYSTEM_PROMPT = `Ты помогаешь осмыслить расшифровку рабочей встречи/разговора. На вход — сырой текст расшифровки.
Верни РОВНО два раздела в markdown, ничего больше (без вступления, без заключения):

## Саммари
5–7 пунктов списком — о чём шла речь.

## Задачи

Сводная таблица задач, СТРОГО в этом формате столбцов:
| # | Задача | Ответственный | Срок | Основание — цитата из расшифровки |
|---|---|---|---|---|

Правила заполнения — соблюдай без исключений:
- НИЧЕГО НЕ ВЫДУМЫВАЙ. Срок не прозвучал в тексте — пиши "срок не задан", не подставляй дату. Исполнителя не назвали явно — пиши "не назначен", не угадывай, кто бы это мог быть.
- Срок записывай ТОЧНО так, как он прозвучал в тексте (например "до вторника", "к концу недели") — не переводи в календарные даты.
- Колонка "Основание" — ДОСЛОВНАЯ короткая цитата из расшифровки в кавычках, по которой можно проверить строку. Если для задачи нет цитаты, подтверждающей её — эту строку добавлять НЕЛЬЗЯ.
- Одна задача = одна строка. Если задача поручена самому говорящему/автору записи — ответственный "я".
- Если в тексте нет ни одной задачи — напиши в таблице одну строку: "Задач не выявлено" в колонке "Задача", остальные колонки — "—".
Отвечай на русском.`;

function chatCompletionsUrl(): string {
  const base = process.env.OPENROUTER_BASE_URL;
  if (!base) throw new Error("OPENROUTER_BASE_URL не задан в ./bot_administrator/.env");
  return `${base.replace(/\/$/, "")}/chat/completions`;
}

/**
 * Саммари + сводная таблица задач по расшифровке через OpenRouter.
 * Возвращает markdown с разделами "## Саммари" и "## Задачи" — готов к вставке в итоговый файл.
 */
export async function analyzeTranscript(transcriptText: string): Promise<string> {
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
        temperature: 0.1, // фактическая выжимка, не творческий текст — не должен выдумывать
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: transcriptText },
        ],
      }),
    });
  } catch (err) {
    throw classifySdkError(err);
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    const kind = res.status === 429 ? "rate_limit" : res.status >= 500 ? "unavailable" : "bad_input";
    throw new ExternalServiceError(kind, `OpenRouter вернул ошибку ${res.status}: ${errorText}`);
  }

  const data = (await res.json().catch(() => null)) as
    | { choices?: { message?: { content?: string } }[] }
    | null;
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new ExternalServiceError("unknown", "OpenRouter не вернул текст ответа");
  }
  return content;
}
