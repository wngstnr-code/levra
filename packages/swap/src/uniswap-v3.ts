import { encodeFunctionData, parseAbi, zeroAddress, type Address, type PublicClient } from "viem";
import { SwapError, type SwapProvider, type SwapQuote } from "./types";

/** The fee tiers of a Uniswap v3 factory, in hundredths of a basis point. */
export const UNISWAP_V3_FEES = [100, 500, 3000, 10000] as const;

const factoryAbi = parseAbi(["function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)"]);
// QuoterV2 simulates the swap and reverts with the result, so it is only ever run through eth_call; declared view for viem.
const quoterAbi = parseAbi([
  "struct QuoteExactInputSingleParams { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }",
  "function quoteExactInputSingle(QuoteExactInputSingleParams params) view returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);
// SwapRouter02 takes no deadline in its params; the router's own deadline covers the transaction.
const swapRouterAbi = parseAbi([
  "struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }",
  "function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)",
]);

export type UniswapV3Options = {
  client: PublicClient;
  factory: Address;
  swapRouter02: Address;
  quoterV2: Address;
  /** How long a pair's pool list is reused before the factory is read again. */
  poolCacheMs?: number;
  now?: () => number;
};

type Pool = { address: Address; fee: number };

/**
 * Uniswap SwapRouter02, called directly (D-85): one hop through the v3 pool of the pair that gives the most for this
 * size, quoted by QuoterV2. The fallback route on X Layer, where the wQQQx / USDC pool is the deep one (05).
 */
export function createUniswapV3({ client, factory, swapRouter02, quoterV2, poolCacheMs = 10 * 60_000, now = Date.now }: UniswapV3Options): SwapProvider {
  const pools = new Map<string, { at: number; list: Pool[] }>();

  async function poolsOf(tokenIn: Address, tokenOut: Address): Promise<Pool[]> {
    const key = [tokenIn.toLowerCase(), tokenOut.toLowerCase()].sort().join(":");
    const cached = pools.get(key);
    if (cached && now() - cached.at < poolCacheMs) return cached.list;
    let addresses: readonly Address[];
    try {
      addresses = await Promise.all(UNISWAP_V3_FEES.map((fee) => client.readContract({ address: factory, abi: factoryAbi, functionName: "getPool", args: [tokenIn, tokenOut, fee] })));
    } catch (err) {
      throw new SwapError("UPSTREAM_ERROR", "Could not read the Uniswap pools.", undefined, err);
    }
    const list = UNISWAP_V3_FEES.map((fee, i) => ({ address: addresses[i]!, fee })).filter((p) => p.address !== zeroAddress);
    pools.set(key, { at: now(), list });
    return list;
  }

  async function best(tokenIn: Address, tokenOut: Address, amountIn: bigint): Promise<{ pool: Pool; amountOut: bigint }> {
    const list = await poolsOf(tokenIn, tokenOut);
    if (list.length === 0) throw new SwapError("NO_ROUTE", "No Uniswap pool for this pair.");
    const quotes = await Promise.allSettled(
      list.map((pool) =>
        client.readContract({ address: quoterV2, abi: quoterAbi, functionName: "quoteExactInputSingle", args: [{ tokenIn, tokenOut, amountIn, fee: pool.fee, sqrtPriceLimitX96: 0n }] }),
      ),
    );
    let winner: { pool: Pool; amountOut: bigint } | null = null;
    for (const [i, q] of quotes.entries()) {
      if (q.status === "fulfilled" && q.value[0] > 0n && (!winner || q.value[0] > winner.amountOut)) winner = { pool: list[i]!, amountOut: q.value[0] };
    }
    if (!winner) throw new SwapError("NO_ROUTE", "No Uniswap pool can fill this size right now.");
    return winner;
  }

  return {
    name: "uniswap",
    target: swapRouter02,
    spender: swapRouter02,

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
            fee: pool.fee,
            recipient: sender,
            amountIn,
            amountOutMinimum: (amountOut * BigInt(10_000 - slippageBps)) / 10_000n,
            sqrtPriceLimitX96: 0n,
          },
        ],
      });
      return { amountIn, amountOut, data, target: swapRouter02 };
    },
  };
}
