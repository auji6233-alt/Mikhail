import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";
import { AssemblyAI } from "assemblyai";
import { ExternalServiceError, classifySdkError, friendlyMessage } from "./errors.js";
import { analyzeTranscript } from "./analyze.js";
import { detectDate, hasDatePrefix } from "./dateDetect.js";

// Ключ и адрес AssemblyAI — тот же .env, что уже настроен для бота (Воркшоп 2).
// Секреты не дублируем, адрес сервиса в коде не хардкодим.
dotenv.config({ path: path.join(import.meta.dirname, "..", "..", "..", "bot_administrator", ".env") });

const TRANSCRIBE_ROOT = path.join(import.meta.dirname, "..");
const RECORDINGS_DIR = path.join(TRANSCRIBE_ROOT, "recordings");
const READY_DIR = path.join(TRANSCRIBE_ROOT, "ready");
const TO_DELETE_DIR = path.join(TRANSCRIBE_ROOT, "to_delete");
const STATS_PATH = path.join(TRANSCRIBE_ROOT, "stats.json");

const TRANSCRIBE_TIMEOUT_MS = 5 * 60_000; // расшифровка может идти долго на длинных записях
const AUDIO_VIDEO_EXT = new Set([
  ".mp3", ".wav", ".m4a", ".ogg", ".oga", ".flac", ".aac", ".wma",
  ".mp4", ".mov", ".avi", ".mkv", ".webm",
]);

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

function getClient(): AssemblyAI {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    throw new Error("ASSEMBLYAI_API_KEY не задан в ./bot_administrator/.env");
  }
  const baseUrl = process.env.ASSEMBLYAI_BASE_URL;
  if (!baseUrl) {
    throw new Error("ASSEMBLYAI_BASE_URL не задан в ./bot_administrator/.env");
  }
  return new AssemblyAI({ apiKey, baseUrl });
}

/**
 * Расшифровывает один файл (pre-recorded) через AssemblyAI.
 * Модель — свежий рекомендованный список из машинной доки (universal-3-5-pro с фолбэком
 * на universal-2), автоопределение языка. SDK сам делает upload + submit + polling.
 */
async function transcribeFile(client: AssemblyAI, filePath: string): Promise<string> {
  let transcript;
  try {
    transcript = await withTimeout(
      client.transcripts.transcribe({
        audio: filePath,
        speech_models: ["universal-3-5-pro", "universal-2"],
        language_detection: true,
      }),
      TRANSCRIBE_TIMEOUT_MS
    );
  } catch (err) {
    throw classifySdkError(err);
  }

  if (transcript.status === "error") {
    throw new ExternalServiceError("bad_input", `AssemblyAI: ${transcript.error}`);
  }
  const text = transcript.text?.trim();
  if (!text) {
    throw new ExternalServiceError("bad_input", "AssemblyAI не распознал текст в записи");
  }
  return text;
}

/** Базовое имя (без расширения) + дата-префикс, если её удалось определить (не дублирует уже имеющийся). */
async function buildBaseName(sourceName: string, filePath: string): Promise<string> {
  const base = path.parse(sourceName).name;
  if (hasDatePrefix(base)) return base;
  const date = await detectDate(sourceName, filePath);
  return date ? `${date}_${base}` : base;
}

/** Если имя в ready/ уже занято — не затирает, добавляет числовой суффикс и предупреждает. */
function reserveOutputPath(baseName: string): string {
  let candidate = path.join(READY_DIR, `${baseName}.md`);
  let n = 2;
  while (fs.existsSync(candidate)) {
    console.log(`⚠️  Имя "${baseName}.md" уже занято в ready/ — сохраняю как "${baseName} (${n}).md".`);
    candidate = path.join(READY_DIR, `${baseName} (${n}).md`);
    n++;
  }
  return candidate;
}

/** ~/путь и относительные пути — в абсолютный путь; ~ разворачиваем сами (шелл может не сделать этого сам). */
function resolveInputPath(raw: string): string {
  const expanded = raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : raw;
  return path.resolve(expanded);
}

type FileResult =
  | { name: string; status: "ok"; outPath: string }
  | { name: string; status: "failed"; reason: string };

/** Один файл целиком: расшифровка → осмысление → сохранение .md. Не бросает исключений наружу. */
async function processFile(client: AssemblyAI, filePath: string, displayName: string): Promise<FileResult> {
  console.log(`Расшифровываю: ${displayName}…`);
  let text: string;
  try {
    text = await transcribeFile(client, filePath);
  } catch (err) {
    const kind = err instanceof ExternalServiceError ? err.kind : "unknown";
    const reason = friendlyMessage(kind);
    console.error(`Не удалось расшифровать "${displayName}": ${reason}`);
    if (err instanceof Error) console.error(`  (подробности в логе: ${err.message})`);
    return { name: displayName, status: "failed", reason: `расшифровка: ${reason}` };
  }

  console.log(`Осмысляю: ${displayName}…`);
  let analysis: string;
  try {
    analysis = await analyzeTranscript(text);
  } catch (err) {
    const kind = err instanceof ExternalServiceError ? err.kind : "unknown";
    console.error(`Расшифровка готова, но не удалось осмыслить "${displayName}": ${friendlyMessage(kind)}`);
    if (err instanceof Error) console.error(`  (подробности в логе: ${err.message})`);
    // Расшифровка не пропадает даже если осмысление не удалось — сохраняем то, что есть.
    analysis = "## Саммари\n\n_Осмысление не удалось получить — см. ошибку выше._\n\n## Задачи\n\n_Не удалось получить._";
  }

  const baseName = await buildBaseName(displayName, filePath);
  const outPath = reserveOutputPath(baseName);
  const combined = `# ${path.parse(displayName).name}\n\n## Расшифровка\n\n${text}\n\n${analysis}\n`;
  fs.writeFileSync(outPath, combined, "utf-8");

  console.log(`Готово → ${outPath}\n`);
  console.log(combined);
  return { name: displayName, status: "ok", outPath };
}

/** stats.json — только цифры и даты, без содержимого и персданных. Обновляется после каждого запуска. */
function writeStats(): void {
  const pendingInRecordings = fs.existsSync(RECORDINGS_DIR)
    ? fs.readdirSync(RECORDINGS_DIR).filter((n) => AUDIO_VIDEO_EXT.has(path.extname(n).toLowerCase())).length
    : 0;

  const readyFiles = fs.existsSync(READY_DIR)
    ? fs.readdirSync(READY_DIR).filter((n) => n.endsWith(".md"))
    : [];
  const readyDates = readyFiles
    .map((n) => n.match(/^(\d{4}-\d{2}-\d{2})_/)?.[1])
    .filter((d): d is string => Boolean(d))
    .sort();

  const stats = {
    updatedAt: new Date().toISOString(),
    pendingInRecordings,
    readyCount: readyFiles.length,
    readyDates,
  };
  fs.writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2) + "\n", "utf-8");
}

function printReport(results: FileResult[]): void {
  if (results.length <= 1) return; // короткий отчёт нужен только при пачке из нескольких файлов
  const ok = results.filter((r) => r.status === "ok");
  const failed = results.filter((r) => r.status === "failed");
  console.log("=== Итог ===");
  console.log(`Расшифровано: ${ok.length} из ${results.length}`);
  for (const r of ok) console.log(`  ✅ ${r.name} → ${r.outPath}`);
  for (const r of failed) console.log(`  ❌ ${r.name} — ${r.reason}`);
}

async function ensureEnv(): Promise<AssemblyAI> {
  const client = getClient();
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY не задан в ./bot_administrator/.env");
  }
  if (!process.env.OPENROUTER_BASE_URL) {
    throw new Error("OPENROUTER_BASE_URL не задан в ./bot_administrator/.env");
  }
  return client;
}

/** Режим А: без аргументов — пачкой всё из recordings/. Успех → файл уезжает в to_delete/. */
async function runBatchMode(client: AssemblyAI): Promise<void> {
  const files = fs
    .readdirSync(RECORDINGS_DIR)
    .filter((name) => AUDIO_VIDEO_EXT.has(path.extname(name).toLowerCase()));

  if (files.length === 0) {
    console.log(`В recordings/ нет аудио/видео файлов — положите запись и запустите снова.`);
    return;
  }

  const results: FileResult[] = [];
  for (const name of files) {
    const filePath = path.join(RECORDINGS_DIR, name);
    const result = await processFile(client, filePath, name);
    results.push(result);
    if (result.status === "ok") {
      fs.mkdirSync(TO_DELETE_DIR, { recursive: true });
      fs.renameSync(filePath, path.join(TO_DELETE_DIR, name));
    }
    // упало — файл сознательно остаётся в recordings/, чтобы можно было разобраться и перезапустить
  }
  printReport(results);
}

/** Режим Б: конкретные пути (в т.ч. вне проекта). Исходник не трогаем — не двигаем, не удаляем. */
async function runExplicitMode(client: AssemblyAI, rawPaths: string[]): Promise<void> {
  const results: FileResult[] = [];
  for (const raw of rawPaths) {
    const filePath = resolveInputPath(raw);
    const displayName = path.basename(filePath);

    if (!fs.existsSync(filePath)) {
      console.error(`Файл не найден: "${raw}" (искал по пути ${filePath})`);
      results.push({ name: raw, status: "failed", reason: "файл не найден" });
      continue;
    }
    if (!AUDIO_VIDEO_EXT.has(path.extname(filePath).toLowerCase())) {
      console.error(`Формат не поддержан: "${displayName}"`);
      results.push({ name: displayName, status: "failed", reason: "формат не поддержан" });
      continue;
    }

    results.push(await processFile(client, filePath, displayName));
  }
  printReport(results);
}

async function main() {
  fs.mkdirSync(READY_DIR, { recursive: true });

  try {
    let client: AssemblyAI;
    try {
      client = await ensureEnv();
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
      return;
    }

    const args = process.argv.slice(2);
    if (args.length === 0) {
      await runBatchMode(client);
    } else {
      await runExplicitMode(client, args);
    }
  } finally {
    // Обновляем stats.json после КАЖДОГО запуска — даже если каталог пуст или .env не настроен.
    writeStats();
  }
}

main();
