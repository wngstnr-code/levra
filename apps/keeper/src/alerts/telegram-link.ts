import { alertSettings, syncCursors, telegramLinks, type Db } from "@levra/db";
import { and, eq, gte, isNull } from "drizzle-orm";
import type { TelegramUpdate } from "./channels";

export const TELEGRAM_CURSOR = "telegram_updates";
/** Same as the API's TELEGRAM_LINK_TTL_SECONDS: a link code is good for 15 minutes. */
const LINK_TTL_SECONDS = 900;

export type TelegramSource = { updates: (offset: number) => Promise<TelegramUpdate[]>; send: (chatId: string, text: string) => Promise<void> };

/**
 * Reads the bot's new messages and links a chat to a wallet when it sends `/start <code>` with a fresh, unused code from
 * `POST /v1/alerts/telegram`. The last update id is kept in `sync_cursors`, so each message is handled once.
 */
export async function linkTelegramChats(db: Db, bot: TelegramSource, now = new Date()): Promise<number> {
  const [cursor] = await db.select().from(syncCursors).where(eq(syncCursors.name, TELEGRAM_CURSOR));
  const updates = await bot.updates(cursor ? Number(cursor.lastBlock) + 1 : 0);
  let linked = 0;
  for (const u of updates) {
    const text = u.message?.text?.trim() ?? "";
    const match = /^\/start ([A-Za-z0-9_-]{1,64})$/.exec(text);
    if (u.message && match) {
      const chatId = String(u.message.chat.id);
      const fresh = new Date(now.getTime() - LINK_TTL_SECONDS * 1000);
      const [link] = await db
        .update(telegramLinks)
        .set({ usedAt: now })
        .where(and(eq(telegramLinks.code, match[1]!), isNull(telegramLinks.usedAt), gte(telegramLinks.createdAt, fresh)))
        .returning({ address: telegramLinks.address });
      if (link) {
        await db
          .insert(alertSettings)
          .values({ address: link.address, email: null, telegramChatId: chatId, preClose: true, ltvThresholdWad: null, autoDeleverage: true, liquidation: true, depositArrived: true, createdAt: now, updatedAt: now })
          .onConflictDoUpdate({ target: alertSettings.address, set: { telegramChatId: chatId, updatedAt: now } });
        linked += 1;
        await bot.send(chatId, "Levra alerts are on for this chat. Change them in the app settings.");
      } else {
        await bot.send(chatId, "This link has expired or was used already. Make a new one in the app settings.");
      }
    }
    await db
      .insert(syncCursors)
      .values({ name: TELEGRAM_CURSOR, lastBlock: BigInt(u.update_id), updatedAt: now })
      .onConflictDoUpdate({ target: syncCursors.name, set: { lastBlock: BigInt(u.update_id), updatedAt: now } });
  }
  return linked;
}
