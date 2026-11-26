import { alertSettings } from "@levra/db";
import { eq } from "drizzle-orm";
import { linkTelegramChats, type TelegramSource } from "../alerts/telegram-link";
import type { Job } from "../runner";
import { answer, type LevraApi } from "./commands";

/** Initial proposal: a chat answer within a few seconds, at one `getUpdates` call each time. */
export const TELEGRAM_INTERVAL_MS = 3_000;

const OFF = "Levra's chat commands are not on yet. Alerts still arrive here.";

/**
 * The Telegram bot (BE-33, BE-78), only in the KEEPER_GLOBAL keeper since Telegram allows one update reader per bot:
 * links chats from `/start <code>` and answers the chat commands of linked chats through the public API. The chat's
 * wallet is the one it was linked to; actions come back as links the user signs in the app, so the bot holds no keys.
 */
export function createTelegramBot({ bot, api, intervalMs = TELEGRAM_INTERVAL_MS }: { bot: TelegramSource; api?: LevraApi; intervalMs?: number }): Job {
  return {
    name: "telegram",
    intervalMs,
    async run({ db, chainId, logger }) {
      let answered = 0;
      const linked = await linkTelegramChats(db, chainId, bot, new Date(), async (chatId, text) => {
        const [settings] = await db.select().from(alertSettings).where(eq(alertSettings.telegramChatId, chatId));
        const reply = api
          ? await answer(
              {
                api,
                wallet: settings?.address ?? null,
                alerts: async () =>
                  settings
                    ? {
                        preClose: settings.preClose,
                        liquidation: settings.liquidation,
                        autoDeleverage: settings.autoDeleverage,
                        depositArrived: settings.depositArrived,
                        ltvThresholdWad: settings.ltvThresholdWad,
                      }
                    : null,
              },
              text,
            )
          : OFF;
        await bot.send(chatId, reply).catch((err: Error) => logger.warn({ error: err.message }, "telegram answer not sent"));
        answered += 1;
      });
      return { linked, answered };
    },
  };
}
