import { baseExternal, baseTokens } from "@levra/shared/addresses";
import { metaMorphoAbi, morphoAbi } from "@levra/shared/abis";
import {
  builderCodes,
  ERC8021_MARKER,
  earnAccount,
  quoteCloseResponse,
  quoteOpenResponse,
  type QuoteCloseResponse,
  type QuoteOpenResponse,
} from "@levra/shared/api";
import { baseDeployment } from "@levra/shared/deployments/base";
import { baseStocks } from "@levra/shared/markets";
import { AERO_TICK_SPACINGS } from "@levra/swap";
import pino from "pino";
import {
  createPublicClient,
  custom,
  encodeFunctionData,
  erc20Abi,
  http,
  parseAbi,
  RpcRequestError,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { base } from "viem/chains";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createChainReader } from "../src/chain/reader";
import { routeForRouter, swapProviders } from "../src/chain/swap";
import { vaultOptionId } from "../src/earn/earn";

/**
 * BE-72: Base quotes and Earn data against a live simulation. A fork cannot run B20 tokens (07), so the API reads a
 * virtual Base: every `eth_call` and `eth_estimateGas` it makes runs inside `eth_simulateV1` on the live node after a
 * list of setup calls (market liquidity, the user's USDC, approval and Morpho authorization, and for a close the open
 * itself). The quote's transaction then runs in the same simulation and the result is compared with the preview.
 * Nothing is sent. Run with BASE_LIVE=1; BASE_RPC_URL defaults to the public endpoint. 1inch joins with ONEINCH_API_KEY.
 */
const live = process.env.BASE_LIVE === "1";
const node = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org", { retryCount: 4, retryDelay: 2_000 }) });
const morpho = baseExternal.morpho;
const usdc = baseTokens.USDC.address;
const router = baseDeployment.router;
const USER = "0x00000000000000000000000000000000ce751d02" as Address;
const LENDER = "0x00000000000000000000000000000000ce751d03" as Address;
/** Holds plenty of USDC on Base; setup calls move some out of it, only inside the simulation. */
const USDC_HOLDER = morpho;
const MARGIN = 100_000_000n;
const MAX_GAS = 25_000_000n;
const ESTIMATE_PRECISION = 5_000n;
const SLIPPAGE_BPS = 100;
// Every quote must run through the router with the Builder Code suffix (BE-74); a test code stands in until ours is set.
builderCodes[8453] ??= "bc_levratest";

type Call = { from: Address; to: Address; data: Hex; gas?: Hex };
type CallResult = { status: Hex; returnData: Hex; gasUsed: Hex; error?: { message?: string } };

const call = (from: Address, to: Address, data: Hex, gas = 3_000_000n): Call => ({ from, to, data, gas: toHex(gas) });
const erc20 = (from: Address, token: Address, functionName: "transfer" | "approve", to: Address, amount: bigint) =>
  call(from, token, encodeFunctionData({ abi: erc20Abi, functionName, args: [to, amount] }), 300_000n);
const morphoCall = (from: Address, data: Hex) => call(from, morpho, data, 500_000n);
const positionCall = (id: Hex) => call(USER, morpho, encodeFunctionData({ abi: morphoAbi, functionName: "position", args: [id, USER] }), 200_000n);
const balanceCall = (token: Address, who: Address) => call(USER, token, encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [who] }), 100_000n);
const txCall = (tx: { to: Address; data: Hex; gasLimit: string }) => call(USER, tx.to, tx.data, BigInt(tx.gasLimit));
const uint = (r: CallResult, word = 0) => BigInt(`0x${r.returnData.slice(2 + word * 64, 2 + (word + 1) * 64)}`);
const ok = (r: CallResult, what: string) => {
  if (r.status !== "0x1") throw new Error(`${what} failed: ${r.error?.message ?? ""} ${r.returnData}`);
};
const bps = (got: bigint, want: bigint) => (want === 0n ? 0 : Number(((got - want) * 10_000n) / want));

/**
 * Every simulation of a case runs on one block. On "latest" the public endpoint answers from different blocks, and a
 * swap route quoted for one block can fail on another, so a replayed open would fail at random.
 */
let pinnedBlock: Hex | "latest" = "latest";

async function simulate(calls: Call[]): Promise<CallResult[]> {
  const params = [{ blockStateCalls: [{ calls }], validation: false }, pinnedBlock];
  const blocks = (await node.request({ method: "eth_simulateV1", params } as never)) as { calls: CallResult[] }[];
  return blocks[0]!.calls;
}

/** A client whose reads see the chain after `setup`. Everything else goes to the live node as is. */
function virtualClient(setup: Call[]): PublicClient {
  return createPublicClient({
    chain: base,
    batch: { multicall: true },
    transport: custom({
      async request({ method, params }: { method: string; params: unknown[] }) {
        if (method !== "eth_call" && method !== "eth_estimateGas") return node.request({ method, params } as never);
        const tx = params[0] as { from?: Address; to: Address; data?: Hex; input?: Hex };
        const run = async (gas: bigint) => {
          const results = await simulate([...setup, { from: tx.from ?? USER, to: tx.to, data: (tx.data ?? tx.input ?? "0x") as Hex, gas: toHex(gas) }]);
          setup.forEach((_, i) => ok(results[i]!, `setup call ${i}`));
          return results.at(-1)!;
        };
        const last = await run(MAX_GAS);
        if (last.status !== "0x1") throw new RpcRequestError({ body: { method }, error: { code: 3, message: "execution reverted", data: last.returnData }, url: "eth_simulateV1" });
        if (method === "eth_call") return last.returnData;
        // Like a node's eth_estimateGas: the lowest limit that succeeds, which is above the gas used (63/64 rule, refunds).
        let low = BigInt(last.gasUsed) - 1n;
        let high = MAX_GAS;
        while (high - low > ESTIMATE_PRECISION) {
          const mid = (low + high) / 2n;
          if ((await run(mid)).status === "0x1") high = mid;
          else low = mid;
        }
        return toHex(high);
      },
    }),
  }) as PublicClient;
}

/**
 * Base as the API's chain. History comes from the indexer in production; here it is empty, since the open only exists
 * inside the simulation (and the public Base node refuses `eth_getLogs`).
 */
function appOn(client: PublicClient) {
  const providers = swapProviders(8453, node as PublicClient, { kyberClientId: "levra", oneInchApiKey: process.env.ONEINCH_API_KEY });
  const swap = routeForRouter(node as PublicClient, router, providers)!;
  return createApp({ logger: pino({ level: "silent" }), reader: createChainReader(client, baseDeployment), swap, events: { forUser: async () => [] } });
}

async function request<T>(client: PublicClient, path: string, body: unknown, parse: (b: unknown) => T): Promise<T> {
  const init = body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  const res = await appOn(client).request(`/v1/8453${path}`, init);
  const json = await res.json();
  if (res.status !== 200) throw new Error(`${path} answered ${res.status}: ${JSON.stringify(json)}`);
  return parse(json);
}

const marketParams = (id: Hex) => node.readContract({ address: morpho, abi: morphoAbi, functionName: "idToMarketParams", args: [id] });

const aeroFactoryAbi = parseAbi(["function getPool(address tokenA, address tokenB, int24 tickSpacing) view returns (address)"]);

/**
 * Whoever holds the most of `token` among Morpho and the token's Aero pools with USDC. Morpho holds less than a share of
 * some stocks on Base (TSLA, MSFT, AMZN on 23 November 2026), while their Aero pools hold hundreds.
 */
async function holderOf(token: Address): Promise<Address> {
  if (token === usdc) return USDC_HOLDER;
  const pools = await Promise.all(
    AERO_TICK_SPACINGS.map((s) => node.readContract({ address: baseExternal.aeroClFactory, abi: aeroFactoryAbi, functionName: "getPool", args: [token, usdc, s] })),
  );
  const candidates = [morpho, ...pools.filter((p) => p !== zeroAddress)];
  const balances = await Promise.all(candidates.map((a) => node.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [a] })));
  return candidates[balances.indexOf(balances.reduce((a, b) => (b > a ? b : a)))]!;
}

/** `from` supplies `amount` of the market's loan token to Morpho, taken from its largest holder. */
async function supplyCalls(from: Address, marketId: Hex, amount: bigint): Promise<Call[]> {
  const p = await marketParams(marketId);
  return [
    erc20(await holderOf(p.loanToken), p.loanToken, "transfer", from, amount),
    erc20(from, p.loanToken, "approve", morpho, amount),
    morphoCall(from, encodeFunctionData({ abi: morphoAbi, functionName: "supply", args: [p, amount, 0n, from, "0x"] })),
  ];
}

/** Liquidity for the market, the user's USDC, approval and Morpho authorization of the router. */
async function setupFor(marketId: Hex, liquidity: bigint): Promise<Call[]> {
  return [
    ...(await supplyCalls(LENDER, marketId, liquidity)),
    erc20(USDC_HOLDER, usdc, "transfer", USER, MARGIN * 3n),
    erc20(USER, usdc, "approve", router, MARGIN * 3n),
    morphoCall(USER, encodeFunctionData({ abi: morphoAbi, functionName: "setAuthorization", args: [router, true] })),
  ];
}

describe.skipIf(!live)("Base quotes and Earn against a live simulation (BE-72)", () => {
  // On a weekend the feed is frozen at Friday's close while the DEX trades, and the router refuses an open further from
  // the oracle than the market's limit. Pick a stock inside it; SPCX has a 3% limit.
  const stock = baseStocks[(process.env.BASE_LIVE_STOCK ?? "SPCX") as keyof typeof baseStocks];
  const marketOf = (side: "long" | "short") => baseDeployment.markets.find((m) => m.symbol === stock.symbol && m.side === side)!;
  const cases = [
    { side: "long" as const, leverageE2: 150, liquidity: 1_000_000_000n },
    // A short borrows the stock, so its market needs stock supplied: 5 shares (8 decimals). Its LTV is about L/(1+L), so
    // 0.7x stays under the closed-market limit (45% for SPCX) on a weekend.
    { side: "short" as const, leverageE2: 70, liquidity: 5n * 10n ** 8n },
  ];

  for (const c of cases) {
    it(`opens and closes an ${stock.symbol} ${c.side} at the quoted amounts`, { timeout: 300_000 }, async () => {
      pinnedBlock = toHex(await node.getBlockNumber());
      const market = marketOf(c.side);
      const setup = await setupFor(market.marketId, c.liquidity);

      const openBody = { user: USER, symbol: stock.symbol, side: c.side, marginRaw: MARGIN.toString(), leverageE2: c.leverageE2, slippageBps: SLIPPAGE_BPS };
      const open: QuoteOpenResponse = await request(virtualClient(setup), "/quote/open", openBody, quoteOpenResponse.parse);
      expect(open.requirements.every((r) => r.satisfied)).toBe(true);
      expect(open.warnings.filter((w) => w.severity === "block")).toEqual([]);
      expect(BigInt(open.tx.gasLimit) > 0n).toBe(true);
      expect(open.tx.data.endsWith(ERC8021_MARKER)).toBe(true);

      const opened = await simulate([...setup, txCall(open.tx), positionCall(market.marketId)]);
      setup.forEach((_, i) => ok(opened[i]!, `setup ${i}`));
      ok(opened[setup.length]!, "open");
      const pos = opened[setup.length + 1]!;
      const collateral = uint(pos, 2);
      const preview = BigInt(open.preview.collateralRaw);
      console.log(`${c.side} open: collateral ${collateral} vs preview ${preview} (${bps(collateral, preview)} bps), gas ${BigInt(opened[setup.length]!.gasUsed)} of ${open.tx.gasLimit}`);
      expect(uint(pos, 1) > 0n).toBe(true);
      // The swap may fill anywhere above the quote less the slippage.
      expect(collateral * 10_000n >= preview * BigInt(10_000 - SLIPPAGE_BPS)).toBe(true);

      // The close is quoted on the chain after the open.
      const afterOpen = [...setup, txCall(open.tx)];
      const closeBody = { user: USER, marketId: market.marketId, fractionWad: (10n ** 18n).toString(), slippageBps: SLIPPAGE_BPS };
      const close: QuoteCloseResponse = await request(virtualClient(afterOpen), "/quote/close", closeBody, quoteCloseResponse.parse);
      expect(close.warnings.filter((w) => w.severity === "block")).toEqual([]);
      expect(BigInt(close.tx.gasLimit) > 0n).toBe(true);
      expect(close.tx.data.endsWith(ERC8021_MARKER)).toBe(true);

      const n = afterOpen.length;
      const closed = await simulate([...afterOpen, balanceCall(usdc, USER), txCall(close.tx), positionCall(market.marketId), balanceCall(usdc, USER), balanceCall(usdc, router), balanceCall(stock.token, router)]);
      ok(closed[n + 1]!, "close");
      const returned = uint(closed[n + 3]!) - uint(closed[n]!);
      const expected = BigInt(close.preview.returnedRaw);
      console.log(`${c.side} close: returned ${returned} vs preview ${expected} (${bps(returned, expected)} bps), gas ${BigInt(closed[n + 1]!.gasUsed)} of ${close.tx.gasLimit}`);
      expect([uint(closed[n + 2]!, 1), uint(closed[n + 2]!, 2)]).toEqual([0n, 0n]);
      expect(returned * 10_000n >= expected * BigInt(10_000 - SLIPPAGE_BPS)).toBe(true);
      // The router ends every transaction with nothing (08).
      expect([uint(closed[n + 4]!), uint(closed[n + 5]!)]).toEqual([0n, 0n]);
    });
  }

  it(`shows a user's ${stock.symbol} supply and vault deposit in Earn`, { timeout: 120_000 }, async () => {
    pinnedBlock = toHex(await node.getBlockNumber());
    const vault = baseDeployment.usdcVault!;
    const shortMarket = marketOf("short").marketId;
    const stockSupply = 2n * 10n ** 8n;
    const setup = [
      ...(await supplyCalls(USER, shortMarket, stockSupply)),
      erc20(USDC_HOLDER, usdc, "transfer", USER, MARGIN),
      erc20(USER, usdc, "approve", vault, MARGIN),
      call(USER, vault, encodeFunctionData({ abi: metaMorphoAbi, functionName: "deposit", args: [MARGIN, USER] }), 2_000_000n),
    ];
    const account = await request(virtualClient(setup), `/earn/${USER}`, undefined, earnAccount.parse);
    const supplied = new Map(account.positions.map((p) => [p.optionId, BigInt(p.suppliedRaw)]));
    console.log(`earn: ${JSON.stringify(account.positions)}`);
    // Morpho rounds a supply down by at most one unit, and the vault's share price by a unit or two.
    expect(stockSupply - supplied.get(`market:${shortMarket}`)!).toBeLessThanOrEqual(1n);
    expect(MARGIN - supplied.get(vaultOptionId(vault))!).toBeLessThanOrEqual(2n);
  });
});
