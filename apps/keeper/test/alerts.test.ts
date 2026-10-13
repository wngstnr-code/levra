import { alertSettings, createDb, runMigrations, syncCursors, telegramLinks } from "@levra/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { preCloseStage } from "../src/alerts/job";
import type { TelegramUpdate } from "../src/alerts/channels";
import { TELEGRAM_CURSOR, linkTelegramChats } from "../src/alerts/telegram-link";

describe("before-close stages (04)", () => {
  const close = 1_800_000_000;
  it("is due at 24 hours, 4 hours and 1 hour before the close, and never after it", () => {
    expect(preCloseStage(close - 86_401, close)).toBeNull();
    expect(preCloseStage(close - 86_400, close)).toBe(86_400);
    expect(preCloseStage(close - 14_401, close)).toBe(86_400);
    expect(preCloseStage(close - 14_400, close)).toBe(14_400);
    expect(preCloseStage(close - 3_600, close)).toBe(3_600);
    expect(preCloseStage(close - 1, close)).toBe(3_600);
    expect(preCloseStage(close, close)).toBeNull();
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("Telegram chat linking (needs TEST_DATABASE_URL)", () => {
  const { db, close } = createDb(url ?? "", { max: 2 });
  const address = "0x00000000000000000000000000000000000a1e47";
  const sent: [string, string][] = [];
  let pending: TelegramUpdate[] = [];
  const offsets: number[] = [];
  const bot = {
    updates: async (offset: number) => {
      offsets.push(offset);
      return pending.filter((u) => u.update_id >= offset);
    },
    send: async (chatId: string, text: string) => void sent.push([chatId, text]),
  };

  beforeAll(async () => {
    await runMigrations(url ?? "");
    await db.delete(syncCursors).where(eq(syncCursors.name, TELEGRAM_CURSOR));
    await db.delete(alertSettings).where(eq(alertSettings.address, address));
    await db.delete(telegramLinks).where(eq(telegramLinks.address, address));
    await db.insert(telegramLinks).values([
      { code: "fresh-code", address, createdAt: new Date() },
      { code: "old-code", address, createdAt: new Date(Date.now() - 3_600_000) },
    ]);
  });
  afterAll(() => close());

  it("links a chat from a fresh code once, refuses old or used codes, and reads each update once", async () => {
    pending = [
      { update_id: 10, message: { chat: { id: 111 }, text: "/start old-code" } },
      { update_id: 11, message: { chat: { id: 222 }, text: "hello" } },
      { update_id: 12, message: { chat: { id: 333 }, text: "/start fresh-code" } },
    ];
    expect(await linkTelegramChats(db, bot)).toBe(1);
    const [row] = await db.select().from(alertSettings).where(eq(alertSettings.address, address));
    expect(row).toMatchObject({ telegramChatId: "333", preClose: true, email: null });
    expect(sent.map(([chat]) => chat)).toEqual(["111", "333"]);

    pending.push({ update_id: 13, message: { chat: { id: 444 }, text: "/start fresh-code" } });
    expect(await linkTelegramChats(db, bot)).toBe(0);
    expect(offsets).toEqual([0, 13]);
    expect((await db.select().from(alertSettings).where(eq(alertSettings.address, address)))[0]?.telegramChatId).toBe("333");
  });
});
