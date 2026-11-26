import { createDb, receiptKeys, runMigrations, tapesendOutbox } from "@levra/db";
import { receiptKeyResponse, receiptsResponse } from "@levra/shared/api";
import { LEVRA_TAPEOUT_XLAYER } from "@levra/tapeout";
import { eq, inArray } from "drizzle-orm";
import pino from "pino";
import { createPublicClient, custom } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { monad } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signToken } from "../src/auth/token";
import { createApp } from "../src/app";
import type { ChainReader } from "../src/chain/reader";
import { parsePatterns } from "../src/origins";

const url = process.env.TEST_DATABASE_URL;
const SECRET = "test-secret-that-is-at-least-32-characters-long";

describe.skipIf(!url)("receipt keys and receipts (BE-84, needs TEST_DATABASE_URL)", () => {
  const { db, close } = createDb(url ?? "", { max: 2 });
  const client = createPublicClient({ chain: monad, transport: custom({ request: async () => { throw new Error("no chain in this test"); } }) });
  const reader = { client, deployment: { chainId: 143, markets: [] } } as unknown as ChainReader;
  const app = createApp({ logger: pino({ level: "silent" }), reader, db, auth: { secret: SECRET, domains: parsePatterns("app.levra.test") } });
  const user = privateKeyToAccount(generatePrivateKey());
  const other = privateKeyToAccount(generatePrivateKey());
  const who = [user.address.toLowerCase(), other.address.toLowerCase()];
  const token = (a: string) => signToken(SECRET, a as `0x${string}`, Math.floor(Date.now() / 1000) + 3_600);
  const call = async (path: string, as: string, init: RequestInit = {}) => {
    const res = await app.request(path, { ...init, headers: { authorization: `Bearer ${token(as)}`, "content-type": "application/json" } });
    return { status: res.status, body: await res.json() };
  };
  // X25519 public keys of the secret keys 0x11..11 and 0x22..22 (TapeKit's sealed vector).
  const publicKey = "0x7b4e909bbe7ffe44c465a220037d608ee35897d31ef972f07f74892cb0f73f13";
  const next = "0x0faa684ed28867b97f4a6a2dee5df8ce974e76b7018e3f22a1c4cf2678570f20";
  const sender = { chainId: 196, hub: LEVRA_TAPEOUT_XLAYER.hub, container: LEVRA_TAPEOUT_XLAYER.container };

  beforeAll(async () => {
    await runMigrations(url ?? "");
    await db.delete(receiptKeys).where(inArray(receiptKeys.address, who));
    await db.delete(tapesendOutbox).where(inArray(tapesendOutbox.address, who));
  });
  afterAll(() => close());

  it("needs a session", async () => {
    expect((await app.request("/v1/receipts/key")).status).toBe(401);
    expect((await app.request("/v1/receipts")).status).toBe(401);
  });

  it("stores, replaces and deletes the wallet's own key, and refuses a key that is not a usable X25519 key", async () => {
    expect(receiptKeyResponse.parse((await call("/v1/receipts/key", user.address)).body)).toEqual({ key: null, sender });
    const put = (as: string, body: unknown) => call("/v1/receipts/key", as, { method: "PUT", body: JSON.stringify(body) });
    expect((await put(user.address, { publicKey: `0x${"00".repeat(32)}`, keyIndex: 0 })).status).toBe(400);
    expect((await put(user.address, { publicKey: `0x${"ff".repeat(32)}`, keyIndex: 0 })).status).toBe(400);
    expect((await put(user.address, { publicKey, keyIndex: 70_000 })).status).toBe(400);

    const saved = await put(user.address, { publicKey, keyIndex: 0 });
    expect(saved.status).toBe(200);
    expect(receiptKeyResponse.parse(saved.body).key).toEqual({ publicKey, keyIndex: 0 });
    // Another wallet sees only its own.
    expect(receiptKeyResponse.parse((await call("/v1/receipts/key", other.address)).body).key).toBeNull();

    expect(receiptKeyResponse.parse((await put(user.address, { publicKey: next, keyIndex: 1 })).body).key).toEqual({ publicKey: next, keyIndex: 1 });
    expect(receiptKeyResponse.parse((await call("/v1/receipts/key", user.address, { method: "DELETE" })).body).key).toBeNull();
    expect(await db.select().from(receiptKeys).where(eq(receiptKeys.address, who[0]!))).toEqual([]);
  });

  it("lists only the wallet's sent receipts, newest first", async () => {
    const row = (address: string, key: string, sentAt: Date | null) => ({
      address,
      key,
      subject: "s",
      body: "b",
      levra: {},
      eventAt: new Date(),
      createdAt: new Date(),
      publicKey: publicKey,
      payload: sentAt ? "0x5453020100" : null,
      txHash: sentAt ? `0x${"ab".repeat(32)}` : null,
      inboxIndex: sentAt ? "7" : null,
      sentAt,
    });
    await db.insert(tapesendOutbox).values([
      row(who[0]!, "196:close:a:1", new Date("2026-11-25T10:00:00Z")),
      row(who[0]!, "196:close:b:1", new Date("2026-11-25T11:00:00Z")),
      row(who[0]!, "196:close:c:1", null),
      row(who[1]!, "196:close:d:1", new Date("2026-11-25T12:00:00Z")),
    ]);
    const list = receiptsResponse.parse((await call("/v1/receipts", user.address)).body);
    expect(list.sender).toEqual(sender);
    expect(list.items.map((i) => i.id)).toEqual(["196:close:b:1", "196:close:a:1"]);
    expect(list.items[0]).toEqual({ id: "196:close:b:1", txHash: `0x${"ab".repeat(32)}`, inboxIndex: "7", payload: "0x5453020100", sentAt: 1_795_604_400 });
  });
});
