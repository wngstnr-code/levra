import { tapesendOutbox, type Db } from "@levra/db";

/** Where alerts go (BE-33). Each channel is off until its key is set. */
export type Channels = {
  email?: (to: string, subject: string, text: string) => Promise<void>;
  telegram?: (chatId: string, text: string) => Promise<void>;
  /** TapeSend (BE-84, D-113): queued for the X Layer sender, for wallets with a receipt key. `key` is the alert's key. */
  tapesend?: (db: Db, address: string, key: string, subject: string, text: string) => Promise<void>;
};

/**
 * Queues an alert as a TapeSend message; the sender in the X Layer keeper seals and sends it. `alert_deliveries` already
 * lets each alert through once, and an LTV alert may come back after the position fell under the level, so the queue
 * key carries the time.
 */
export const tapesendQueue: NonNullable<Channels["tapesend"]> = async (db, address, key, subject, text) => {
  const now = new Date();
  await db.insert(tapesendOutbox).values({ address, key: `alert:${key}:${now.getTime()}`, subject, body: text, levra: { type: "alert", key }, eventAt: now, createdAt: now });
};

const TIMEOUT_MS = 15_000;

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

/** Email through Resend's HTTP API. Proposal: any provider with an HTTP API fits behind this function. */
export function resendEmail(apiKey: string, from: string): NonNullable<Channels["email"]> {
  return async (to, subject, text) => {
    await post("https://api.resend.com/emails", { authorization: `Bearer ${apiKey}` }, { from, to: [to], subject, text });
  };
}

export type TelegramUpdate = { update_id: number; message?: { chat: { id: number }; text?: string } };

/** Telegram Bot API: sending, and reading the bot's updates for the link codes. */
export function telegramBot(token: string) {
  const base = `https://api.telegram.org/bot${token}`;
  return {
    send: async (chatId: string, text: string) => {
      await post(`${base}/sendMessage`, {}, { chat_id: chatId, text, disable_web_page_preview: true });
    },
    updates: async (offset: number): Promise<TelegramUpdate[]> => {
      const body = (await post(`${base}/getUpdates`, {}, { offset, timeout: 0, allowed_updates: ["message"] })) as { result: TelegramUpdate[] };
      return body.result;
    },
  };
}
