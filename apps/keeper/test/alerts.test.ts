import { alertSettings, createDb, runMigrations, syncCursors, telegramLinks } from "@levra/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { haltAlert, liftedAlert, preCloseStage } from "../src/alerts/job";
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

describe("halt alerts (BE-75)", () => {
  const held = { positions: [{ symbol: "QQQ", label: "QQQ long" }, { symbol: "HOOD", label: "HOOD short" }], lends: true };
  const qqq = { key: "gate:b20-paused:QQQ", symbol: "QQQ", message: "aQQQ paused.", since: 100 };
  const usdc = { key: "gate:usdc-paused", symbol: null, message: "USDC paused.", since: 200 };

  it("names only the positions the halt covers, and lending only for a chain-wide halt", () => {
    expect(haltAlert(qqq, held, "Base")).toMatchObject({ key: "halt:gate:b20-paused:QQQ:100", text: expect.stringContaining("Affected: QQQ long.") });
    expect(haltAlert(usdc, held, "Base")?.text).toContain("Affected: QQQ long, HOOD short, USDC lent in Earn.");
    expect(haltAlert(qqq, { positions: [{ symbol: "HOOD", label: "HOOD short" }], lends: true }, "Base")).toBeNull();
    expect(haltAlert(usdc, { positions: [], lends: false }, "Base")).toBeNull();
  });

  it("follows a sent halt with one lifted alert once its block is gone, and not while it lasts", () => {
    const active = new Set(["gate:b20-paused:QQQ:100"]);
    expect(liftedAlert("halt:gate:b20-paused:QQQ:100", active, "aQQQ paused", "Base")).toBeNull();
    // The same control blocked again later is a different block.
    expect(liftedAlert("halt:gate:b20-paused:QQQ:50", active, "aQQQ paused", "Base")).toMatchObject({ key: "lifted:gate:b20-paused:QQQ:50", text: expect.stringContaining("aQQQ paused: no longer blocking.") });
    expect(liftedAlert("ltv:0xabc", active, undefined, "Base")).toBeNull();
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
    expect(await linkTelegramChats(db, 143, bot)).toBe(1);
    const [row] = await db.select().from(alertSettings).where(eq(alertSettings.address, address));
    expect(row).toMatchObject({ telegramChatId: "333", preClose: true, email: null });
    expect(sent.map(([chat]) => chat)).toEqual(["111", "333"]);

    pending.push({ update_id: 13, message: { chat: { id: 444 }, text: "/start fresh-code" } });
    expect(await linkTelegramChats(db, 143, bot)).toBe(0);
    expect(offsets).toEqual([0, 13]);
    expect((await db.select().from(alertSettings).where(eq(alertSettings.address, address)))[0]?.telegramChatId).toBe("333");
  });
});
