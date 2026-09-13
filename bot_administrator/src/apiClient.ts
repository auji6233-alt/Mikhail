/** Клиент защищённого API приложения (/api/bot/*). Адрес и ключ — из ./bot_administrator/.env. */

type ApiResult =
  | { ok: true; data: unknown }
  | { ok: false; status: number; error: string };

function baseUrl(): string {
  const url = process.env.APP_API_URL;
  if (!url) throw new Error("APP_API_URL не задан в ./bot_administrator/.env");
  return url.replace(/\/$/, "");
}

function apiKey(): string {
  const key = process.env.APP_API_KEY;
  if (!key) throw new Error("APP_API_KEY не задан в ./bot_administrator/.env");
  return key;
}

async function callApi(pathAndQuery: string, init?: RequestInit): Promise<ApiResult> {
  const res = await fetch(`${baseUrl()}${pathAndQuery}`, {
    ...init,
    headers: {
      "X-API-Key": apiKey(),
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = typeof data === "object" && data && "error" in data ? String((data as { error: unknown }).error) : "Ошибка API";
    return { ok: false, status: res.status, error };
  }
  return { ok: true, data };
}

export function getServices(): Promise<ApiResult> {
  return callApi("/api/bot/services");
}

export function getMasters(serviceId: string): Promise<ApiResult> {
  return callApi(`/api/bot/masters?serviceId=${encodeURIComponent(serviceId)}`);
}

export function getAvailability(params: {
  masterId: string;
  serviceId: string;
  date: string;
}): Promise<ApiResult> {
  const q = new URLSearchParams(params).toString();
  return callApi(`/api/bot/availability?${q}`);
}

export function createBooking(input: {
  serviceId: string;
  masterId: string;
  startISO: string;
  clientName: string;
  clientPhone: string;
  comment?: string;
}): Promise<ApiResult> {
  return callApi("/api/bot/bookings", { method: "POST", body: JSON.stringify(input) });
}
