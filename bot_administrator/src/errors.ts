/** Типизированная ошибка внешнего сервиса — чтобы бот мог ответить клиенту по-человечески. */
export type ExternalErrorKind = "timeout" | "rate_limit" | "unavailable" | "bad_input" | "unknown";

export class ExternalServiceError extends Error {
  kind: ExternalErrorKind;
  constructor(kind: ExternalErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.kind = kind;
    this.name = "ExternalServiceError";
  }
}

/** Классифицирует HTTP-ответ внешнего сервиса по статусу. */
export function classifyHttpStatus(status: number): ExternalErrorKind {
  if (status === 429) return "rate_limit";
  if (status >= 500) return "unavailable";
  if (status >= 400) return "bad_input";
  return "unknown";
}

/** Классифицирует сетевую ошибку (fetch throw / AbortError и т.п.). */
export function classifyNetworkError(err: unknown): ExternalErrorKind {
  if (err instanceof Error && err.name === "AbortError") return "timeout";
  return "unavailable";
}

/** Человеческое сообщение клиенту — без технических деталей. */
export function friendlyMessage(kind: ExternalErrorKind, context: "модель" | "распознавание речи" | "запись"): string {
  switch (kind) {
    case "timeout":
      return "Сервис сейчас отвечает медленнее обычного. Попробуйте, пожалуйста, ещё раз через минуту.";
    case "rate_limit":
      return "Сейчас слишком много запросов одновременно — подождите, пожалуйста, немного и попробуйте снова.";
    case "unavailable":
      return context === "запись"
        ? "Сервис записи временно недоступен. Попробуйте, пожалуйста, чуть позже."
        : "Сервис временно недоступен. Попробуйте, пожалуйста, чуть позже.";
    case "bad_input":
      return context === "распознавание речи"
        ? "Не получилось распознать голосовое сообщение — попробуйте ещё раз или напишите текстом."
        : "Не получилось обработать запрос — попробуйте переформулировать.";
    default:
      return "Что-то пошло не так. Попробуйте, пожалуйста, ещё раз.";
  }
}

/** Достаёт ExternalErrorKind из произвольной ошибки (в т.ч. нетипизированной). */
export function kindOf(err: unknown): ExternalErrorKind {
  if (err instanceof ExternalServiceError) return err.kind;
  return classifyNetworkError(err);
}
