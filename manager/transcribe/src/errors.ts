/** Типизированная ошибка внешнего сервиса — чтобы вывести понятное сообщение, а не стек. */
export type ExternalErrorKind = "timeout" | "rate_limit" | "unavailable" | "bad_input" | "unknown";

export class ExternalServiceError extends Error {
  kind: ExternalErrorKind;
  constructor(kind: ExternalErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.kind = kind;
    this.name = "ExternalServiceError";
  }
}

/** Грубая эвристика по сообщению ошибки SDK — его тип ошибок не документирован явно. */
export function classifySdkError(err: unknown): ExternalServiceError {
  if (err instanceof ExternalServiceError) return err;
  if (err instanceof Error && err.name === "AbortError") {
    return new ExternalServiceError("timeout", "AssemblyAI не ответил вовремя", { cause: err });
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/429|rate limit|too many requests/i.test(message)) {
    return new ExternalServiceError("rate_limit", message, { cause: err });
  }
  return new ExternalServiceError("unavailable", message, { cause: err });
}

/** Человеческое сообщение вместо стека — печатается в консоль. */
export function friendlyMessage(kind: ExternalErrorKind): string {
  switch (kind) {
    case "timeout":
      return "AssemblyAI отвечает медленнее обычного — попробуйте ещё раз через минуту.";
    case "rate_limit":
      return "Слишком много запросов к AssemblyAI одновременно — подождите немного и повторите.";
    case "unavailable":
      return "AssemblyAI сейчас недоступен — попробуйте, пожалуйста, чуть позже.";
    case "bad_input":
      return "Не получилось распознать эту запись (повреждённый файл или неподдерживаемый формат).";
    default:
      return "Не получилось расшифровать запись — попробуйте ещё раз.";
  }
}
