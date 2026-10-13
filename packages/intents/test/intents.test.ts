import { afterEach, describe, expect, it, vi } from "vitest";
import { createIntents, IntentsError, toTransferStatus } from "../src/index";

const NOW = 1_800_000_000;

describe("status names", () => {
  it("maps the service's status to ours, and expires a quote nobody paid into", () => {
    expect(toTransferStatus("PENDING_DEPOSIT", NOW + 1, NOW)).toBe("WAITING");
    expect(toTransferStatus("PENDING_DEPOSIT", NOW, NOW)).toBe("EXPIRED");
    expect(toTransferStatus("INCOMPLETE_DEPOSIT", NOW - 1, NOW)).toBe("WAITING");
    expect(toTransferStatus("KNOWN_DEPOSIT_TX", NOW, NOW)).toBe("PROCESSING");
    expect(toTransferStatus("PROCESSING", NOW, NOW)).toBe("PROCESSING");
    expect(toTransferStatus("SUCCESS", NOW, NOW)).toBe("SUCCESS");
    expect(toTransferStatus("REFUNDED", NOW, NOW)).toBe("REFUNDED");
    expect(toTransferStatus("FAILED", NOW, NOW)).toBe("FAILED");
  });
});

describe("1Click client", () => {
  afterEach(() => vi.unstubAllGlobals());
  const answer = (status: number, body: unknown) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));

  it("sends an exact-input quote and reads the deposit address", async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ quote: { amountIn: "5000000", amountOut: "4988330", minAmountOut: "4938446", timeEstimate: 37, deadline: "2026-10-16T18:54:41.208Z", depositAddress: "0x96d174b8281e72bBF7A9a02900832e4ADcdB9443" } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetch);
    const q = await createIntents({ jwt: "token" }).quote({ originAsset: "a", destinationAsset: "b", amount: 5_000_000n, recipient: "0x1", refundTo: "0x2", slippageBps: 100, deadline: new Date(0) });
    expect(q).toMatchObject({ depositAddress: "0x96d174b8281e72bBF7A9a02900832e4ADcdB9443", depositMemo: null, amountOut: 4_988_330n, estimatedSeconds: 37, expiresAt: Math.floor(Date.parse("2026-10-16T18:54:41.208Z") / 1000) });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://1click.chaindefuser.com/v0/quote");
    expect(JSON.parse(String(init.body))).toMatchObject({ dry: false, swapType: "EXACT_INPUT", amount: "5000000", depositType: "ORIGIN_CHAIN", refundType: "ORIGIN_CHAIN", recipientType: "DESTINATION_CHAIN" });
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer token");
  });

  it("turns a refusal into BAD_REQUEST with the service's reason, and a 429 into RATE_LIMITED", async () => {
    answer(400, { message: "Amount is too low for bridge, try at least 1.1" });
    await expect(createIntents().tokens()).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Amount is too low for bridge, try at least 1.1" });
    answer(429, {});
    await expect(createIntents().tokens()).rejects.toBeInstanceOf(IntentsError);
    await expect(createIntents().tokens()).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("reads the transaction hashes and the delivered amount from the status", async () => {
    answer(200, {
      status: "SUCCESS",
      updatedAt: "2026-10-14T01:00:00.000Z",
      swapDetails: { amountOut: "4990000", originChainTxHashes: [{ hash: "0xorigin" }], destinationChainTxHashes: [{ hash: "0xdest" }] },
    });
    expect(await createIntents().status("0xaddr", null, NOW)).toEqual({
      status: "SUCCESS",
      upstreamStatus: "SUCCESS",
      originTxHash: "0xorigin",
      destinationTxHash: "0xdest",
      amountOut: 4_990_000n,
      updatedAt: Date.parse("2026-10-14T01:00:00.000Z") / 1000,
    });
  });
});

describe.skipIf(!process.env.INTENTS_LIVE)("live 1Click (needs INTENTS_LIVE=1)", () => {
  it("lists USDC on Monad and quotes 5 USDC from Base into it", { timeout: 60_000 }, async () => {
    const intents = createIntents();
    const tokens = await intents.tokens();
    const usdc = tokens.find((t) => t.blockchain === "monad" && t.symbol === "USDC")!;
    const base = tokens.find((t) => t.blockchain === "base" && t.symbol === "USDC")!;
    expect(usdc.contractAddress?.toLowerCase()).toBe("0x754704bc059f8c67012fed69bc8a327a5aafb603");
    const recipient = "0x70297E9b7f4cCE6272Ef830e3Df8744760bC1855";
    const q = await intents.quote({ originAsset: base.assetId, destinationAsset: usdc.assetId, amount: 5_000_000n, recipient, refundTo: recipient, slippageBps: 100, deadline: new Date(Date.now() + 3_600_000) });
    expect(q.amountOut > 4_900_000n && q.amountOut < 5_000_000n).toBe(true);
    expect((await intents.status(q.depositAddress, q.depositMemo, q.expiresAt)).status).toBe("WAITING");
  });
});
