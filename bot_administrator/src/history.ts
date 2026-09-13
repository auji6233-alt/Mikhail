export type ChatMessage = { role: "user" | "assistant"; content: string };

const HISTORY_LIMIT = 5;
const chatHistories = new Map<number, ChatMessage[]>();

/** Память диалога: последние ~5 сообщений этого чата Telegram (по каждому чату отдельно). */
export function getHistory(chatId: number): ChatMessage[] {
  return chatHistories.get(chatId) ?? [];
}

export function pushHistory(chatId: number, message: ChatMessage): void {
  const history = chatHistories.get(chatId) ?? [];
  history.push(message);
  chatHistories.set(chatId, history.slice(-HISTORY_LIMIT));
}
