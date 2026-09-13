import fs from "node:fs";
import path from "node:path";

const botDir = path.join(import.meta.dirname, "..");

function readFileSafe(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8").trim();
  } catch {
    return "";
  }
}

/**
 * Системная инструкция собирается один раз при старте из:
 * role.md (роль администратора), character.md (тон/характер) и faq/faq.md (база знаний).
 */
export function buildSystemPrompt(): string {
  const role = readFileSafe(path.join(botDir, "role.md"));
  const character = readFileSafe(path.join(botDir, "character.md"));
  const faq = readFileSafe(path.join(botDir, "..", "faq", "faq.md"));

  return [
    "Ты — AI-администратор сервиса онлайн-записи. Отвечай на языке, на котором пишет клиент.",
    "",
    "## Роль",
    role,
    "",
    "## Характер и стиль общения",
    character,
    "",
    "## База знаний (единственный источник фактов)",
    faq,
    "",
    "## Главное правило",
    "Отвечай ТОЛЬКО на основе базы знаний выше. Если ответа на вопрос клиента в базе знаний нет — " +
      "честно скажи, что не знаешь, и предложи уточнить вопрос или обратиться напрямую в сервис. " +
      "НЕ придумывай и НЕ додумывай похожие факты (цены, время, мастеров, условия) — это запрещено.",
  ].join("\n");
}
