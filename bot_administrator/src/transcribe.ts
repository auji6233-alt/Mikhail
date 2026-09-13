import { AssemblyAI } from "assemblyai";

let client: AssemblyAI | null = null;

function getClient(): AssemblyAI {
  if (!client) {
    const apiKey = process.env.ASSEMBLYAI_API_KEY;
    if (!apiKey) {
      throw new Error("ASSEMBLYAI_API_KEY не задан в ./bot_administrator/.env");
    }
    client = new AssemblyAI({ apiKey });
  }
  return client;
}

/**
 * Расшифровывает голосовое сообщение (pre-recorded) через AssemblyAI.
 * Модель universal-2 (поддерживает русский), автоопределение языка (ru/en).
 * SDK сам делает upload + submit + polling — ждать готовности вручную не нужно.
 */
export async function transcribeVoice(audio: Buffer): Promise<string> {
  const transcript = await getClient().transcripts.transcribe({
    audio,
    speech_models: ["universal-2"],
    language_detection: true,
  });

  if (transcript.status === "error") {
    throw new Error(`AssemblyAI: ${transcript.error}`);
  }
  const text = transcript.text?.trim();
  if (!text) {
    throw new Error("AssemblyAI не распознал текст в голосовом сообщении");
  }
  return text;
}
