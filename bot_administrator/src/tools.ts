import * as api from "./apiClient.js";

/** Описания инструментов в формате OpenAI-совместимого function calling (OpenRouter). */
export const toolSchemas = [
  {
    type: "function",
    function: {
      name: "get_services",
      description: "Список услуг, на которые можно записаться (название, цена, длительность).",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_masters",
      description: "Список мастеров, которые оказывают указанную услугу.",
      parameters: {
        type: "object",
        properties: {
          serviceId: { type: "string", description: "id услуги (из get_services)" },
        },
        required: ["serviceId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_availability",
      description: "Свободные слоты времени у мастера на конкретную дату под конкретную услугу.",
      parameters: {
        type: "object",
        properties: {
          masterId: { type: "string", description: "id мастера (из get_masters)" },
          serviceId: { type: "string", description: "id услуги (из get_services)" },
          date: { type: "string", description: "дата в формате YYYY-MM-DD" },
        },
        required: ["masterId", "serviceId", "date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_booking",
      description: "Создать запись клиента на услугу к мастеру на конкретное время.",
      parameters: {
        type: "object",
        properties: {
          serviceId: { type: "string", description: "id услуги" },
          masterId: { type: "string", description: "id мастера" },
          startISO: { type: "string", description: "начало записи, ISO-время (из get_availability)" },
          clientName: { type: "string", description: "имя клиента" },
          clientPhone: { type: "string", description: "телефон клиента" },
          comment: { type: "string", description: "необязательный комментарий" },
        },
        required: ["serviceId", "masterId", "startISO", "clientName", "clientPhone"],
      },
    },
  },
] as const;

type ToolArgs = Record<string, unknown>;
/** Данные о текущем диалоге, которые подставляет код, а не модель (модели не доверяем chatId). */
export type ToolContext = { chatId: string };

/** Выполняет вызов инструмента по имени и возвращает результат для передачи модели обратно. */
export async function callTool(name: string, args: ToolArgs, context: ToolContext): Promise<unknown> {
  switch (name) {
    case "get_services":
      return api.getServices();
    case "get_masters":
      return api.getMasters(String(args.serviceId));
    case "get_availability":
      return api.getAvailability({
        masterId: String(args.masterId),
        serviceId: String(args.serviceId),
        date: String(args.date),
      });
    case "create_booking":
      return api.createBooking({
        serviceId: String(args.serviceId),
        masterId: String(args.masterId),
        startISO: String(args.startISO),
        clientName: String(args.clientName),
        clientPhone: String(args.clientPhone),
        comment: args.comment ? String(args.comment) : undefined,
        telegramChatId: context.chatId,
      });
    default:
      return { ok: false, error: `Неизвестный инструмент: ${name}` };
  }
}
