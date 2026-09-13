import { NextResponse } from "next/server";

/**
 * Единый ответ на неожиданную ошибку (БД недоступна, сеть и т.п.) — клиент не должен
 * видеть техническую подробность (stack trace, текст ошибки Prisma). Реальная причина
 * уходит в лог сервера.
 */
export function handleApiError(err: unknown): NextResponse {
  console.error("Необработанная ошибка в API:", err);
  return NextResponse.json(
    { error: "Сервис временно недоступен, попробуйте, пожалуйста, чуть позже" },
    { status: 503 }
  );
}
