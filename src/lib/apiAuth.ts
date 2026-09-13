import { NextRequest, NextResponse } from "next/server";

/**
 * Проверка ключа для /api/bot/* — отдельного защищённого входа для бота.
 * Публичные /api/* (которыми пользуется сайт из браузера) этой проверкой не покрыты
 * и продолжают работать как раньше — иначе сломалась бы публичная страница /book.
 */
export function checkApiKey(req: NextRequest): NextResponse | null {
  const expected = process.env.APP_API_KEY;
  const provided = req.headers.get("x-api-key");
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "Неверный или отсутствующий API-ключ" }, { status: 401 });
  }
  return null;
}
