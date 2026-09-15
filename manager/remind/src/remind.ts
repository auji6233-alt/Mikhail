import path from "node:path";
import dotenv from "dotenv";
import { Client } from "pg";

// Секреты бота (токен, адрес Telegram-прокси) — из bot_administrator/.env.
dotenv.config({ path: path.join(import.meta.dirname, "..", "..", "..", "bot_administrator", ".env") });
// Строка подключения к БД — из .env основного приложения.
dotenv.config({ path: path.join(import.meta.dirname, "..", "..", "..", ".env") });

const token = process.env.TELEGRAM_BOT_TOKEN;
const apiBase = process.env.TELEGRAM_API_BASE;
const databaseUrl = process.env.DATABASE_URL;
if (!token || !apiBase || !databaseUrl) {
  throw new Error("Нужны TELEGRAM_BOT_TOKEN, TELEGRAM_API_BASE и DATABASE_URL в .env");
}

type Row = {
  id: string;
  clientName: string;
  telegramChatId: string | null;
  startAt: string;
  service_name: string;
  master_name: string;
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

function buildMessage(row: Row): string {
  const firstName = row.clientName.split(" ")[0];
  const time = formatTime(row.startAt);
  return `Здравствуйте, ${firstName}! Напоминаем: завтра, ${time} у вас запись на «${row.service_name}» к мастеру ${row.master_name}. Если планы изменились — напишите нам здесь же.`;
}

/** Отправка через Telegram Bot API. Сама не бросает наружу — сообщает об успехе/неудаче. */
async function sendReminder(chatId: string, text: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const res = await fetch(`${apiBase}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (!res.ok || !data.ok) {
      return { ok: false, reason: data.description ?? `Telegram вернул ошибку ${res.status}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "Telegram сейчас недоступен — попробуйте запустить ещё раз позже" };
  }
}

async function main() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  let rows: Row[];
  try {
    const result = await client.query<Row>(
      `SELECT b.id, b."clientName", b."telegramChatId", b."startAt"::text AS "startAt",
              s.name AS service_name, m.name AS master_name
       FROM "Booking" b
       JOIN "Service" s ON s.id = b."serviceId"
       JOIN "Master" m ON m.id = b."masterId"
       WHERE b.status = 'CONFIRMED'
         AND b."remindedAt" IS NULL
         AND b."startAt"::date = (CURRENT_DATE + INTERVAL '1 day')
       ORDER BY b."startAt" ASC`
    );
    rows = result.rows;
  } finally {
    await client.end();
  }

  const today = new Date().toLocaleDateString("ru-RU", { timeZone: "UTC" });
  console.log(`Напоминания на завтра (${today}, записей: ${rows.length})\n`);

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const label = `${row.clientName}, ${formatTime(row.startAt).split(" в ")[1] ?? ""}, ${row.service_name} у ${row.master_name}`.trim();

    if (!row.telegramChatId) {
      console.log(`⏭️  Пропущено (нет Telegram-чата — запись с сайта): ${label}`);
      skipped++;
      continue;
    }

    const text = buildMessage(row);
    const result = await sendReminder(row.telegramChatId, text);

    if (result.ok) {
      const markClient = new Client({ connectionString: databaseUrl });
      try {
        await markClient.connect();
        await markClient.query(`UPDATE "Booking" SET "remindedAt" = now() WHERE id = $1`, [row.id]);
      } finally {
        await markClient.end();
      }
      console.log(`✅ Отправлено: ${label} (chat ${row.telegramChatId})`);
      sent++;
    } else {
      console.log(`❌ Ошибка: ${label} (chat ${row.telegramChatId}) — ${result.reason}`);
      failed++;
    }
  }

  console.log(`\nИтог: ${sent} отправлено, ${skipped} пропущено, ${failed} ошибок`);
}

main().catch((err) => {
  console.error("Не удалось выполнить рассылку напоминаний:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
