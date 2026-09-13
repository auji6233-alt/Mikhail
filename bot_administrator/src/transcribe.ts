import { AssemblyAI } from "assemblyai";
import { ExternalServiceError } from "./errors.js";

let client: AssemblyAI | null = null;

// Upload + submit + polling готового аудио может занять время, но не бесконечно —
// если AssemblyAI завис, клиент не должен ждать ответа вечно.
const TRANSCRIBE_TIMEOUT_MS = 60_000;

function getClient(): AssemblyAI {
  if (!client) {
    const apiKey = process.env.ASSEMBLYAI_API_KEY;
    if (!apiKey) {
      throw new Error("ASSEMBLYAI_API_KEY не задан в ./bot_administrator/.env");
    }
    const baseUrl = process.env.ASSEMBLYAI_BASE_URL;
    if (!baseUrl) {
      throw new Error("ASSEMBLYAI_BASE_URL не задан в ./bot_administrator/.env");
    }
    client = new AssemblyAI({ apiKey, baseUrl });
  }
  return client;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new ExternalServiceError("timeout", "AssemblyAI не ответил вовремя")),
      ms
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/** Грубая эвристика по сообщению ошибки SDK — его тип ошибок не документирован явно. */
function classifySdkError(err: unknown): ExternalServiceError {
  if (err instanceof ExternalServiceError) return err;
  const message = err instanceof Error ? err.message : String(err);
  if (/429|rate limit|too many requests/i.test(message)) {
    return new ExternalServiceError("rate_limit", message, { cause: err });
  }
  if (/5\d\d|unavailable|econnreset|etimedout|fetch failed/i.test(message)) {
    return new ExternalServiceError("unavailable", message, { cause: err });
  }
  return new ExternalServiceError("unavailable", message, { cause: err });
}

/**
 * Расшифровывает голосовое сообщение (pre-recorded) через AssemblyAI.
 * Модель universal-2 (поддерживает русский), автоопределение языка (ru/en).
 * SDK сам делает upload + submit + polling — ждать готовности вручную не нужно.
 */
export async function transcribeVoice(audio: Buffer): Promise<string> {
  let transcript;
  try {
    transcript = await withTimeout(
      getClient().transcripts.transcribe({
        audio,
        speech_models: ["universal-2"],
        language_detection: true,
      }),
      TRANSCRIBE_TIMEOUT_MS
    );
  } catch (err) {
    throw classifySdkError(err);
  }

  if (transcript.status === "error") {
    // Обычно означает проблему с самим аудио (повреждённый файл, неподдерживаемый формат) —
    // это "кривой ввод" от клиента, а не сбой сервиса.
    throw new ExternalServiceError("bad_input", `AssemblyAI: ${transcript.error}`);
  }
  const text = transcript.text?.trim();
  if (!text) {
    throw new ExternalServiceError("bad_input", "AssemblyAI не распознал текст в голосовом сообщении");
  }
  return text;
}
