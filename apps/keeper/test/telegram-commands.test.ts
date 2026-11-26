import { describe, expect, it } from "vitest";
import { HELP, LevraApiError, NOT_LINKED, answer, parseAmount, parseLeverage, type AlertView, type LevraApi } from "../src/telegram/commands";

const wallet = "0x00000000000000000000000000000000000A6e77";
const nvdaLong = `0x${"11".repeat(32)}`;
const nvdaShortX = `0x${"22".repeat(32)}`;

const chains = {
  chains: [
    { chainId: 143, slug: "monad", name: "Monad", nativeSymbol: "MON", live: true },
    { chainId: 8453, slug: "base", name: "Base", nativeSymbol: "ETH", live: true },
    { chainId: 196, slug: "xlayer", name: "X Layer", nativeSymbol: "OKB", live: true },
  ],
  defaultChainId: 143,
};

function position(over: Record<string, unknown>) {
  return {
    marketId: nvdaLong,
    symbol: "NVDA",
    side: "long",
    stockAmountRaw: "1000000000000000000",
    collateralRaw: "1000000000000000000",
    debtRaw: "50000000",
    valueUsdRaw: "180000000",
    equityUsdRaw: "130000000",
    entryPriceE8: "15000000000",
    oraclePriceE8: "18000000000",
    unrealizedPnlUsdRaw: "30000000",
    pnlBps: 3000,
    ltvWad: "277777777777777777",
    softLtvWad: "730000000000000000",
    lltvWad: "770000000000000000",
    liqPriceE8: "6493506493",
    liqDistanceBps: -6392,
    protection: false,
    overSoftLimit: false,
    gapScenarios: [],
    ...over,
  };
}

function account(positions: unknown[]) {
  return { address: wallet, positions, totals: { equityUsdRaw: "0", debtUsdRaw: "0", unrealizedPnlUsdRaw: "0" }, walletBalances: [], morphoAuthorized: true, updatedAtBlock: 1 };
}

const circuit = { processor: "0x4D5Bf68e1362046B0281b9bA678345b7FD2aAa5c", circuitId: 2, healthy: true, belowSoftLimit: true, matches: true };

/** A public API that answers from fixed data and records the actions it was asked to prepare. */
function fakeApi(opts: { accounts?: Record<number, unknown[]>; failChain?: number; prepareError?: LevraApiError } = {}) {
  const prepared: { path: string; body: unknown }[] = [];
  const accounts = opts.accounts ?? { 143: [], 8453: [], 196: [] };
  const api: LevraApi = {
    get: async (path) => {
      if (path === "/v1/chains") return chains;
      const m = /^\/v1\/(\d+)\/(\w+)/.exec(path)!;
      const chainId = Number(m[1]);
      if (chainId === opts.failChain) throw new LevraApiError("UPSTREAM_ERROR", "rpc down");
      if (m[2] === "accounts") return account(accounts[chainId] ?? []);
      if (m[2] === "session")
        return {
          session: "REGULAR",
          closedRegime: false,
          nextCloseAt: Date.UTC(2026, 10, 27, 18) / 1000,
          nextOpenAt: null,
          updatedAt: 1,
          ...(chainId === 196 ? { clock: { ...circuit, circuitId: 1, session: "REGULAR", holiday: false, weekend: false, earlyClose: true } } : {}),
        };
      if (m[2] === "markets") return { markets: chainId === 196 || chainId === 8453 ? [{ symbol: "NVDA", side: "long" }, { symbol: "NVDA", side: "short" }] : [{ symbol: "QQQ", side: "long" }] };
      throw new Error(`unexpected ${path}`);
    },
    post: async (path, body) => {
      if (opts.prepareError) throw opts.prepareError;
      prepared.push({ path, body });
      return {
        id: "id",
        url: "https://app.levra.finance/prepared/id",
        expiresAt: 1,
        summary: "Prepared.",
        ...(path.startsWith("/v1/196/") ? { circuitCheck: { risk: circuit, gap: { processor: circuit.processor, circuitId: 2, moveBps: -1_500, healthyAfterGap: false, matches: true }, clock: null } } : {}),
      };
    },
  };
  return { api, prepared };
}

const alerts: AlertView = { preClose: true, liquidation: true, autoDeleverage: false, depositArrived: true, ltvThresholdWad: "700000000000000000" };
const ctx = (api: LevraApi, linked = true) => ({ api, wallet: linked ? wallet : null, alerts: async () => (linked ? alerts : null) });

describe("chat amounts", () => {
  it("reads decimals strictly and refuses too many decimals or zero", () => {
    expect(parseAmount("100", 6)).toBe(100_000_000n);
    expect(parseAmount("1,000.5", 6)).toBe(1_000_500_000n);
    expect(parseAmount("0.0000001", 6)).toBeNull();
    expect(parseAmount("0", 6)).toBeNull();
    expect(parseAmount("-5", 6)).toBeNull();
    expect(parseAmount("1e3", 6)).toBeNull();
  });

  it("reads leverage as x100 and refuses 1x or less", () => {
    expect(parseLeverage("2x")).toBe(200);
    expect(parseLeverage("1.5")).toBe(150);
    expect(parseLeverage("2.25X")).toBe(225);
    expect(parseLeverage("1x")).toBeNull();
    expect(parseLeverage("abc")).toBeNull();
  });
});

describe("chat commands (BE-78)", () => {
  it("helps, and asks an unlinked chat to link before anything about a wallet", async () => {
    const { api } = fakeApi();
    expect(await answer(ctx(api), "/start")).toBe(HELP);
    expect(await answer(ctx(api), "hello")).toBe(HELP);
    expect(await answer(ctx(api), "/nope")).toContain("Unknown command /nope");
    expect(await answer(ctx(api, false), "/positions")).toBe(NOT_LINKED);
    expect(await answer(ctx(api, false), "/close NVDA long")).toBe(NOT_LINKED);
  });

  it("lists positions on every chain with the circuit answer on X Layer, and names a chain it cannot read", async () => {
    const { api } = fakeApi({ accounts: { 143: [], 8453: [position({})], 196: [position({ marketId: nvdaShortX, side: "short", circuit })] }, failChain: 143 });
    const text = await answer(ctx(api), "/positions@LevraBot");
    expect(text).toContain("Monad: could not read (UPSTREAM_ERROR).");
    expect(text).toContain("NVDA long on Base\n  Value $180.00, P&L +$30.00 (+30.00%)\n  Debt ratio 27.77%, liquidation at 77.00%, liquidation price about $64.94");
    expect(text).toContain("NVDA short on X Layer");
    expect(text).toContain("TapeOut risk circuit #2: healthy, under the soft limit.");
  });

  it("says when a position has no price, and when the circuit disagrees", async () => {
    const { api } = fakeApi({ accounts: { 196: [position({ oraclePriceE8: "0", circuit: { ...circuit, matches: false } })], 8453: [position({ overSoftLimit: true, protection: true })] } });
    const text = await answer(ctx(api), "/positions");
    expect(text).toContain("Over the soft limit: you cannot add to it through Levra, and protection may reduce it.");
    expect(text).toContain("No oracle price right now; you can still close it in full.");
    expect(text).toContain("disagrees with Levra's numbers");
  });

  it("shows the session on every chain and the clock circuit on X Layer", async () => {
    const { api } = fakeApi();
    expect(await answer(ctx(api), "/session")).toBe(
      [
        "Monad: regular, next close 2026-11-27 18:00 UTC",
        "Base: regular, next close 2026-11-27 18:00 UTC",
        "X Layer: regular, next close 2026-11-27 18:00 UTC (Wall Street Clock circuit: regular)",
      ].join("\n"),
    );
  });

  it("prepares an open on the chain named, or asks which when the market is on more than one", async () => {
    const { api, prepared } = fakeApi();
    expect(await answer(ctx(api), "/open NVDA long 100 2x")).toBe("NVDA long is on base and xlayer: add the chain at the end.");
    const text = await answer(ctx(api), "/open nvda long 100 2x xlayer");
    expect(prepared).toEqual([
      { path: "/v1/196/agent/prepare", body: { kind: "open", request: { user: wallet, symbol: "NVDA", side: "long", marginRaw: "100000000", leverageE2: 200, slippageBps: 50 } } },
    ]);
    expect(text).toContain("Review and sign in the Levra app (the link works for an hour): https://app.levra.finance/prepared/id");
    expect(text).toContain("Position after this: healthy, under the soft limit.");
    expect(text).toContain("After a -15% gap: would be liquidated.");
    expect(await answer(ctx(api), "/open QQQ long 50 1.5")).toContain("Prepared.");
    expect(prepared.at(-1)?.path).toBe("/v1/143/agent/prepare");
    expect(await answer(ctx(api), "/open NVDA long 100 1x base")).toContain("Usage: /open");
    expect(await answer(ctx(api), "/open NVDA long 100 2x solana")).toBe('Unknown chain "solana". Live chains: monad, base, xlayer.');
  });

  it("prepares a close of a percent, all by default, on the chain that has the position", async () => {
    const { api, prepared } = fakeApi({ accounts: { 8453: [position({})] } });
    await answer(ctx(api), "/close NVDA long 50");
    await answer(ctx(api), "/close NVDA long");
    await answer(ctx(api), "/close NVDA long 12.5% base");
    expect(prepared.map((p) => [p.path, (p.body as { request: { fractionWad: string } }).request.fractionWad])).toEqual([
      ["/v1/8453/agent/prepare", "500000000000000000"],
      ["/v1/8453/agent/prepare", "1000000000000000000"],
      ["/v1/8453/agent/prepare", "125000000000000000"],
    ]);
    expect(await answer(ctx(api), "/close NVDA long 150")).toContain("Usage: /close");
    expect(await answer(ctx(api), "/close NVDA short")).toBe("No NVDA short position. Send /positions to see yours.");
    expect(await answer(ctx(api), "/close NVDA long xlayer")).toBe("No NVDA long position on X Layer. Send /positions to see yours.");
  });

  it("asks for the chain when the same position is open on two chains", async () => {
    const { api } = fakeApi({ accounts: { 8453: [position({})], 196: [position({})] } });
    expect(await answer(ctx(api), "/close NVDA long")).toBe("You have a NVDA long on base and xlayer: add the chain at the end.");
  });

  it("adds USDC to a short and shares to a long, in the token's own decimals", async () => {
    const { api, prepared } = fakeApi({ accounts: { 196: [position({ marketId: nvdaShortX, side: "short" }), position({})] } });
    await answer(ctx(api), "/add NVDA short 50");
    await answer(ctx(api), "/add NVDA long 0.5");
    expect(prepared.map((p) => p.body)).toEqual([
      { kind: "collateral", request: { user: wallet, marketId: nvdaShortX, action: "add", amountRaw: "50000000" } },
      { kind: "collateral", request: { user: wallet, marketId: nvdaLong, action: "add", amountRaw: "500000000000000000" } },
    ]);
    expect(await answer(ctx(api), "/add NVDA short 0.0000001")).toContain("Usage: /add");
  });

  it("passes the API's refusal on in plain words", async () => {
    const { api } = fakeApi({ accounts: { 8453: [position({})] }, prepareError: new LevraApiError("TERMS_NOT_ACCEPTED", "Accept the terms in the app first.") });
    expect(await answer(ctx(api), "/close NVDA long")).toBe("Levra could not do that: Accept the terms in the app first.");
  });

  it("shows the chat's alerts", async () => {
    const { api } = fakeApi();
    const text = await answer(ctx(api), "/alerts");
    expect(text).toContain("Auto-deleverage: off");
    expect(text).toContain("Debt ratio level: 70.00%");
  });
});
