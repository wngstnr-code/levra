import { encodeFunctionData, parseAbi, zeroAddress, type Address, type PublicClient } from "viem";
import { SwapError, type SwapProvider, type SwapQuote } from "./types";

/** Tick spacings the Aero Slipstream factory enables on Base, read from its constructor arguments (05). */
export const AERO_TICK_SPACINGS = [1, 10, 50, 100, 150, 200, 250] as const;

const factoryAbi = parseAbi(["function getPool(address tokenA, address tokenB, int24 tickSpacing) view returns (address)"]);
// The Metaquoter simulates the swap and reverts with the result, so it is only ever run through eth_call; declared view for viem.
const metaQuoterAbi = parseAbi([
  "function quoteExactInputSingleV3(address pool, address tokenIn, uint256 amountIn, uint160 sqrtPriceLimitX96) view returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed)",
]);
const swapRouterAbi = parseAbi([
  "struct ExactInputSingleParams { address tokenIn; address tokenOut; int24 tickSpacing; address recipient; uint256 deadline; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }",
  "function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)",
]);

export type AeroOptions = {
  client: PublicClient;
  factory: Address;
  swapRouter: Address;
  metaQuoter: Address;
  /** Seconds the built swap stays valid; the router's deadline check uses block time. */
  deadlineSeconds?: number;
  /** How long a pair's pool list is reused before the factory is read again. */
  poolCacheMs?: number;
  now?: () => number;
};

type Pool = { address: Address; tickSpacing: number };

/**
 * The Aero SwapRouter, called directly (D-80): one hop through the Slipstream pool of the pair that gives the most
 * for this size, quoted by the Metaquoter. Holds the deepest stock pools on Base (05).
 */
export function createAero({ client, factory, swapRouter, metaQuoter, deadlineSeconds = 120, poolCacheMs = 10 * 60_000, now = Date.now }: AeroOptions): SwapProvider {
  const pools = new Map<string, { at: number; list: Pool[] }>();

  async function poolsOf(tokenIn: Address, tokenOut: Address): Promise<Pool[]> {
    const key = [tokenIn.toLowerCase(), tokenOut.toLowerCase()].sort().join(":");
    const cached = pools.get(key);
    if (cached && now() - cached.at < poolCacheMs) return cached.list;
    let addresses: readonly Address[];
    try {
      addresses = await Promise.all(AERO_TICK_SPACINGS.map((s) => client.readContract({ address: factory, abi: factoryAbi, functionName: "getPool", args: [tokenIn, tokenOut, s] })));
    } catch (err) {
      throw new SwapError("UPSTREAM_ERROR", "Could not read the Aero pools.", undefined, err);
    }
    const list = AERO_TICK_SPACINGS.map((tickSpacing, i) => ({ address: addresses[i]!, tickSpacing })).filter((p) => p.address !== zeroAddress);
    pools.set(key, { at: now(), list });
    return list;
  }

  async function best(tokenIn: Address, tokenOut: Address, amountIn: bigint): Promise<{ pool: Pool; amountOut: bigint }> {
    const list = await poolsOf(tokenIn, tokenOut);
    if (list.length === 0) throw new SwapError("NO_ROUTE", "No Aero pool for this pair.");
    const quotes = await Promise.allSettled(
      list.map((pool) => client.readContract({ address: metaQuoter, abi: metaQuoterAbi, functionName: "quoteExactInputSingleV3", args: [pool.address, tokenIn, amountIn, 0n] })),
    );
    let winner: { pool: Pool; amountOut: bigint } | null = null;
    for (const [i, q] of quotes.entries()) {
      if (q.status === "fulfilled" && q.value[0] > 0n && (!winner || q.value[0] > winner.amountOut)) winner = { pool: list[i]!, amountOut: q.value[0] };
    }
    if (!winner) throw new SwapError("NO_ROUTE", "No Aero pool can fill this size right now.");
    return winner;
  }

  return {
    name: "aero",
    target: swapRouter,
    spender: swapRouter,

    async price({ tokenIn, tokenOut, amountIn }) {
      return (await best(tokenIn, tokenOut, amountIn)).amountOut;
    },

    async quote({ tokenIn, tokenOut, amountIn, sender, slippageBps }): Promise<SwapQuote> {
      if (slippageBps < 0 || slippageBps >= 10_000) throw new SwapError("UPSTREAM_ERROR", "Slippage must be below 100%.");
      const { pool, amountOut } = await best(tokenIn, tokenOut, amountIn);
      const data = encodeFunctionData({
        abi: swapRouterAbi,
        functionName: "exactInputSingle",
        args: [
          {
            tokenIn,
            tokenOut,
            tickSpacing: pool.tickSpacing,
            recipient: sender,
            deadline: BigInt(Math.floor(now() / 1000) + deadlineSeconds),
            amountIn,
            amountOutMinimum: (amountOut * BigInt(10_000 - slippageBps)) / 10_000n,
            sqrtPriceLimitX96: 0n,
          },
        ],
      });
      return { amountIn, amountOut, data, target: swapRouter };
    },
  };
}
