import { createDb, runMigrations, termsAcceptances } from "@levra/db";
import type { IntentsSource } from "@levra/intents";
import type { SwapSource } from "@levra/kyber";
import { eligibilityResponse, termsAcceptResponse, termsMessage } from "@levra/shared/api";
import { eq } from "drizzle-orm";
import pino from "pino";
import { createPublicClient, custom } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { monad } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { ChainReader } from "../src/chain/reader";

const url = process.env.TEST_DATABASE_URL;
const VERSION = "test-2026-10-14";

describe("terms text", () => {
  it("is the text written in 03, line by line", () => {
    expect(termsMessage("v1", "0xAbC")).toBe(
      "Levra terms of use\nVersion: v1\nAddress: 0xAbC\nI confirm that I am not a resident of, or located in, a restricted region, that I read the risk disclosure, and that I accept the terms of use.",
    );
  });
});

describe.skipIf(!url)("region and terms (needs TEST_DATABASE_URL)", () => {
  const { db, close } = createDb(url ?? "", { max: 2 });
  // Plain wallets are checked without the chain.
  const client = createPublicClient({ chain: monad, transport: custom({ request: async () => { throw new Error("no chain in this test"); } }) });
  // Reaching these means the gate let the request through.
  const reader = { client, deployment: { chainId: 143, markets: [] }, markets: async () => { throw new Error("past the gate"); } } as unknown as ChainReader;
  const swap = {} as SwapSource;
  const intents = { tokens: async () => { throw new Error("past the gate"); } } as unknown as IntentsSource;
  const app = createApp({
    logger: pino({ level: "silent" }),
    reader,
    swap,
    db,
    intents,
    compliance: { termsVersion: VERSION, countryHeader: "cf-ipcountry", blockedCountries: new Set(["US", "KP"]) },
  });
  const user = privateKeyToAccount(generatePrivateKey());
  const from = (country: string | null) => (country ? { "cf-ipcountry": country } : {});
  const post = (path: string, body: unknown, country: string | null = "ID") =>
    app.request(path, { method: "POST", headers: { "content-type": "application/json", ...from(country) }, body: JSON.stringify(body) });
  const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

  beforeAll(async () => {
    await runMigrations(url ?? "");
    await db.delete(termsAcceptances).where(eq(termsAcceptances.address, user.address.toLowerCase()));
  });
  afterAll(() => close());

  it("tells a blocked region, and a request with no country, that it is not eligible", async () => {
    const check = async (country: string | null) => eligibilityResponse.parse(await (await app.request(`/v1/eligibility?address=${user.address}`, { headers: from(country) })).json());
    expect(await check("ID")).toEqual({ eligible: true, reason: null, termsVersion: VERSION, termsAccepted: false });
    expect(await check("us")).toMatchObject({ eligible: false, reason: "REGION_BLOCKED" });
    expect(await check(null)).toMatchObject({ eligible: false, reason: "REGION_BLOCKED" });
    expect(eligibilityResponse.parse(await (await app.request("/v1/eligibility", { headers: from("ID") })).json()).termsAccepted).toBeNull();
  });

  it("gates opening and depositing until the terms are accepted, and never closing or withdrawing", async () => {
    const open = { user: user.address, symbol: "QQQ", side: "long", marginRaw: "1000000", leverageE2: 150, slippageBps: 100 };
    const deposit = { recipient: user.address, originChain: "base", originToken: "x", amountRaw: "5000000", refundAddress: user.address, includeGas: false };
    expect(await errorCode(await post("/v1/quote/open", open))).toBe("TERMS_NOT_ACCEPTED");
    expect(await errorCode(await post("/v1/deposit/quote", deposit))).toBe("TERMS_NOT_ACCEPTED");
    expect(await errorCode(await post("/v1/quote/open", open, "US"))).toBe("REGION_BLOCKED");
    expect((await post("/v1/quote/open", open, "US")).status).toBe(403);

    // Closing and withdrawing go straight to their engines, also from a blocked region.
    const close = await post("/v1/quote/close", { user: user.address, marketId: `0x${"ab".repeat(32)}`, fractionWad: "1000000000000000000", slippageBps: 100 }, "US");
    expect(["REGION_BLOCKED", "TERMS_NOT_ACCEPTED"]).not.toContain(await errorCode(close));
    const withdraw = await post("/v1/withdraw/quote", { user: user.address, destinationChain: "base", destinationToken: "x", amountRaw: "1000000", recipient: user.address }, "US");
    expect(["REGION_BLOCKED", "TERMS_NOT_ACCEPTED"]).not.toContain(await errorCode(withdraw));
  });

  it("records an acceptance signed by the wallet, refuses another signer or an old version, and then lets the user through", async () => {
    const message = termsMessage(VERSION, user.address);
    const other = privateKeyToAccount(generatePrivateKey());
    expect(await errorCode(await post("/v1/terms/accept", { address: user.address, termsVersion: VERSION, signature: await other.signMessage({ message }) }))).toBe("UNAUTHORIZED");
    expect(await errorCode(await post("/v1/terms/accept", { address: user.address, termsVersion: "old", signature: await user.signMessage({ message: termsMessage("old", user.address) }) }))).toBe("BAD_REQUEST");
    expect(await errorCode(await post("/v1/terms/accept", { address: user.address, termsVersion: VERSION, signature: await user.signMessage({ message }) }, "US"))).toBe("REGION_BLOCKED");

    const res = await post("/v1/terms/accept", { address: user.address, termsVersion: VERSION, signature: await user.signMessage({ message }) });
    expect(res.status).toBe(200);
    termsAcceptResponse.parse(await res.json());
    const [row] = await db.select().from(termsAcceptances).where(eq(termsAcceptances.address, user.address.toLowerCase()));
    expect(row).toMatchObject({ termsVersion: VERSION, country: "ID" });

    const open = { user: user.address, symbol: "QQQ", side: "long", marginRaw: "1000000", leverageE2: 150, slippageBps: 100 };
    // Past the gate the stand-in reader fails, which proves the gate let it through.
    expect(await errorCode(await post("/v1/quote/open", open))).toBe("UPSTREAM_ERROR");
    expect(eligibilityResponse.parse(await (await app.request(`/v1/eligibility?address=${user.address}`, { headers: from("ID") })).json()).termsAccepted).toBe(true);
  });
});
