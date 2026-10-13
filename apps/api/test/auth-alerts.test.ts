import { alertSettings as alertSettingsTable, createDb, runMigrations, telegramLinks } from "@levra/db";
import { alertSettings, authNonceResponse, siweResponse, telegramLinkResponse } from "@levra/shared/api";
import { eq } from "drizzle-orm";
import pino from "pino";
import { createPublicClient, custom, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { monad } from "viem/chains";
import { createSiweMessage } from "viem/siwe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signToken, verifyToken } from "../src/auth/token";
import { createApp } from "../src/app";
import type { ChainReader } from "../src/chain/reader";
import { parsePatterns } from "../src/origins";

const url = process.env.TEST_DATABASE_URL;
const SECRET = "test-secret-that-is-at-least-32-characters-long";
const DOMAIN = "app.levra.test";

describe("session tokens", () => {
  const address = privateKeyToAccount(generatePrivateKey()).address;
  it("give back the wallet while valid, and nothing when forged or expired", () => {
    const token = signToken(SECRET, address, 2_000);
    expect(verifyToken(SECRET, token, 1_999)).toBe(address);
    expect(verifyToken(SECRET, token, 2_000)).toBeNull();
    expect(verifyToken("another-secret-that-is-at-least-32-characters", token, 1_000)).toBeNull();
    expect(verifyToken(SECRET, token.replace(".2000.", ".9999."), 1_000)).toBeNull();
    expect(verifyToken(SECRET, "nonsense", 1_000)).toBeNull();
  });
});

describe.skipIf(!url)("wallet sign-in and alert settings (needs TEST_DATABASE_URL)", () => {
  const { db, close } = createDb(url ?? "", { max: 2 });
  // Plain wallets are checked without the chain; a call means a smart wallet, which this test does not use.
  const client = createPublicClient({ chain: monad, transport: custom({ request: async () => { throw new Error("no chain in this test"); } }) });
  const reader = { client, deployment: { chainId: 143, markets: [] } } as unknown as ChainReader;
  const app = createApp({ logger: pino({ level: "silent" }), reader, db, auth: { secret: SECRET, domains: parsePatterns(`${DOMAIN},levra-mon-*-team.vercel.app`), telegramBot: "levra_alerts_bot" } });
  const user = privateKeyToAccount(generatePrivateKey());

  const json = async (res: Response) => ({ status: res.status, body: await res.json() });
  const nonce = async () => authNonceResponse.parse(await (await app.request("/v1/auth/nonce")).json()).nonce;
  const message = (n: string, overrides: Partial<Parameters<typeof createSiweMessage>[0]> = {}) =>
    createSiweMessage({ address: user.address, chainId: 143, domain: DOMAIN, nonce: n, uri: `https://${DOMAIN}`, version: "1", issuedAt: new Date(), ...overrides });
  const signIn = async (msg: string, signature?: Hex) =>
    json(await app.request("/v1/auth/siwe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: msg, signature: signature ?? (await user.signMessage({ message: msg })) }) }));
  const withToken = (token: string, init: RequestInit = {}) => ({ ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" } });

  let token: string;
  beforeAll(async () => {
    await runMigrations(url ?? "");
    await db.delete(alertSettingsTable).where(eq(alertSettingsTable.address, user.address.toLowerCase()));
  });
  afterAll(() => close());

  it("signs in once per nonce and refuses another site, another network or a wrong signature", async () => {
    const n = await nonce();
    expect((await signIn(message(n, { domain: "evil.test" }))).status).toBe(401);
    expect((await signIn(message(n, { chainId: 1 }))).status).toBe(401);
    const other = privateKeyToAccount(generatePrivateKey());
    const msg = message(n);
    expect((await signIn(msg, await other.signMessage({ message: msg }))).status).toBe(401);

    const ok = await signIn(msg);
    expect(ok.status).toBe(200);
    token = siweResponse.parse(ok.body).token;
    // The nonce is spent.
    expect((await signIn(msg)).status).toBe(401);
    // A preview address of this project signs in too; another project's preview does not.
    expect((await signIn(message(await nonce(), { domain: "levra-mon-git-fe-x-team.vercel.app" }))).status).toBe(200);
    expect((await signIn(message(await nonce(), { domain: "levra-mon-x.other.vercel.app" }))).status).toBe(401);
  });

  it("needs a session for the alert settings", async () => {
    expect((await app.request("/v1/alerts")).status).toBe(401);
    expect((await app.request("/v1/alerts", withToken("bad.token.value"))).status).toBe(401);
  });

  it("starts from the defaults, saves changes and keeps what was not sent", async () => {
    expect(alertSettings.parse((await json(await app.request("/v1/alerts", withToken(token)))).body)).toEqual({
      channels: { email: null, telegramLinked: false },
      events: { preClose: true, ltvThresholdWad: null, autoDeleverage: true, liquidation: true, depositArrived: true },
    });
    const put = (body: unknown) => app.request("/v1/alerts", withToken(token, { method: "PUT", body: JSON.stringify(body) }));
    const saved = await json(await put({ channels: { email: "trader@example.com" }, events: { ltvThresholdWad: "650000000000000000", depositArrived: false } }));
    expect(saved.status).toBe(200);
    expect(alertSettings.parse(saved.body)).toEqual({
      channels: { email: "trader@example.com", telegramLinked: false },
      events: { preClose: true, ltvThresholdWad: "650000000000000000", autoDeleverage: true, liquidation: true, depositArrived: false },
    });
    expect(alertSettings.parse((await json(await put({ events: { preClose: false } }))).body).events).toMatchObject({ preClose: false, ltvThresholdWad: "650000000000000000" });
    expect((await put({ events: { ltvThresholdWad: "1000000000000000000" } })).status).toBe(400);
    expect((await put({ channels: { email: "not an email" } })).status).toBe(400);
  });

  it("hands out a one-time Telegram link for the signed-in wallet", async () => {
    const link = telegramLinkResponse.parse((await json(await app.request("/v1/alerts/telegram", withToken(token, { method: "POST" })))).body);
    const code = new URL(link.url).searchParams.get("start")!;
    expect(link.url.startsWith("https://t.me/levra_alerts_bot?start=")).toBe(true);
    expect(code).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    const [row] = await db.select().from(telegramLinks).where(eq(telegramLinks.code, code));
    expect(row?.address).toBe(user.address.toLowerCase());
  });
});
