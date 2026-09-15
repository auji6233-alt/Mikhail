import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DATE_PREFIX_RE = /^(\d{4})-(\d{2})-(\d{2})_/;

/** Уже есть префикс ГГГГ-ММ-ДД_ в начале имени — дублировать не нужно. */
export function hasDatePrefix(fileName: string): boolean {
  return DATE_PREFIX_RE.test(fileName);
}

function isPlausibleDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  if (y < 2000 || y > 2100) return false;
  return true;
}

function toISO(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Ищет дату в самом имени файла — несколько распространённых форматов. */
function detectDateInFileName(fileName: string): string | null {
  let m = fileName.match(/(20\d{2})-(\d{2})-(\d{2})/); // 2026-09-15
  if (m) {
    const [, y, mo, d] = m.map(Number) as unknown as number[];
    if (isPlausibleDate(y, mo, d)) return toISO(y, mo, d);
  }
  m = fileName.match(/(20\d{2})(\d{2})(\d{2})(?!\d)/); // 20260915
  if (m) {
    const [, y, mo, d] = m.map(Number) as unknown as number[];
    if (isPlausibleDate(y, mo, d)) return toISO(y, mo, d);
  }
  m = fileName.match(/(\d{2})[.-](\d{2})[.-](20\d{2})/); // 15.09.2026 / 15-09-2026
  if (m) {
    const [, d, mo, y] = m.map(Number) as unknown as number[];
    if (isPlausibleDate(y, mo, d)) return toISO(y, mo, d);
  }
  return null;
}

/** Читает creation_time из метаданных контейнера через ffprobe, если он установлен. */
async function detectDateFromMediaMetadata(filePath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "quiet",
      "-print_format", "json",
      "-show_entries", "format_tags=creation_time",
      filePath,
    ]);
    const parsed = JSON.parse(stdout) as { format?: { tags?: { creation_time?: string } } };
    const raw = parsed.format?.tags?.creation_time;
    if (!raw) return null;
    const dt = new Date(raw);
    if (Number.isNaN(dt.getTime())) return null;
    return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  } catch {
    // ffprobe не установлен, файл без метаданных или без тега — это нормально, просто нет даты
    return null;
  }
}

/**
 * Определяет дату записи: сначала из имени файла, затем из метаданных аудио/видео (ffprobe).
 * Ничего не находит — возвращает null, и префикс к имени результата не добавляется.
 */
export async function detectDate(fileName: string, filePath: string): Promise<string | null> {
  return detectDateInFileName(fileName) ?? (await detectDateFromMediaMetadata(filePath));
}
