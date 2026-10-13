import { createDb, deposits, runMigrations } from "@levra/db";
import { IntentsError, type IntentsSource } from "@levra/intents";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTransferWatcher } from "../src/transfers/watcher";

const url = process.env.TEST_DATABASE_URL;
const USER = "0x00000000000000000000000000000000007a7c11";

describe.skipIf(!url)("transfer watcher (needs TEST_DATABASE_URL)", () => {
  const { db, close } = createDb(url ?? "", { max: 2 });
  const ctx = { db, logger: pino({ level: "silent" }), signal: new AbortController().signal };
  const upstream = new Map<string, string>([["0xa", "PENDING_DEPOSIT"], ["0xb", "PROCESSING"], ["0xc", "SUCCESS"]]);
  const asked: string[] = [];
  const intents: IntentsSource = {
    tokens: async () => [],
    quote: async () => {
      throw new Error("not used");
    },
    status: async (address) => {
      asked.push(address);
      if (address === "0xd") throw new IntentsError("UPSTREAM_ERROR", "down");
      const s = upstream.get(address)!;
      const status = s === "SUCCESS" ? "SUCCESS" : s === "PROCESSING" ? "PROCESSING" : "WAITING";
      return { status, upstreamStatus: s, originTxHash: null, destinationTxHash: s === "SUCCESS" ? "0xdest" : null, amountOut: s === "SUCCESS" ? 990n : null, updatedAt: 0 };
    },
  };
  const row = (id: string, depositAddress: string, status: string, ageDays = 0) => ({
    id,
    kind: "deposit",
    user: USER,
    originAsset: "base-usdc",
    destinationAsset: "monad-usdc",
    amountInRaw: "1000",
    quotedOutRaw: "998",
    depositAddress,
    recipient: USER,
    refundTo: USER,
    status,
    quote: {},
    expiresAt: new Date(Date.now() + 86_400_000),
    createdAt: new Date(Date.now() - ageDays * 86_400_000),
    updatedAt: new Date(Date.now() - ageDays * 86_400_000),
  });

  beforeAll(async () => {
    await runMigrations(url ?? "");
    await db.delete(deposits).where(eq(deposits.user, USER));
    await db.insert(deposits).values([
      row("watch-a", "0xa", "WAITING"),
      row("watch-b", "0xb", "WAITING"),
      row("watch-c", "0xc", "PROCESSING"),
      row("watch-d", "0xd", "WAITING"),
      row("watch-done", "0xe", "SUCCESS"),
      row("watch-old", "0xf", "WAITING", 5),
    ]);
  });
  afterAll(async () => {
    await db.delete(deposits).where(eq(deposits.user, USER));
    await close();
  });

  it("follows open transfers only, stores what changed, and keeps going when one read fails", async () => {
    const result = await createTransferWatcher({ intents }).run(ctx);
    expect(asked.filter((a) => ["0xa", "0xb", "0xc", "0xd", "0xe", "0xf"].includes(a)).sort()).toEqual(["0xa", "0xb", "0xc", "0xd"]);
    expect(result).toMatchObject({ changed: 2 });
    const byId = new Map((await db.select().from(deposits).where(eq(deposits.user, USER))).map((r) => [r.id, r]));
    expect(byId.get("watch-a")).toMatchObject({ status: "WAITING", upstreamStatus: "PENDING_DEPOSIT" });
    expect(byId.get("watch-b")?.status).toBe("PROCESSING");
    expect(byId.get("watch-c")).toMatchObject({ status: "SUCCESS", destinationTxHash: "0xdest", amountOutRaw: "990" });
    expect(byId.get("watch-c")!.updatedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(byId.get("watch-d")?.checkedAt).toBeNull();
  });
});