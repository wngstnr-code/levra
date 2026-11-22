import { decodeFunctionData, getAddress, parseAbi, zeroAddress, type Address, type PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import { createAero } from "../src/index";

const factory = getAddress("0x9cb220581b91b0c83223012fe69688b92ad07a76");
const swapRouter = getAddress("0x9ee35bf1bd69a03c6f0393582030fce8bb93d418");
const metaQuoter = getAddress("0x1ddfec5058180c207f55bb77d95acdd0d8227868");
const usdc = getAddress("0x00000000000000000000000000000000000a5dc0");
const nvda = getAddress("0x00000000000000000000000000000000000b0a00");
const sender = getAddress("0x00000000000000000000000000000000000ce751");
const pool10 = getAddress("0x00000000000000000000000000000000000a0010");
const pool100 = getAddress("0x00000000000000000000000000000000000a0100");

/** A stand-in chain: pools by tick spacing, and the Metaquoter's answer per pool (a string makes it revert). */
function chain(pools: Record<number, Address>, outs: Record<Address, bigint | string>) {
  const reads: string[] = [];
  const client = {
    async readContract({ functionName, args }: { functionName: string; args: readonly unknown[] }) {
      reads.push(functionName);
      if (functionName === "getPool") return pools[Number(args[2])] ?? zeroAddress;
      const out = outs[args[0] as Address];
      if (typeof out === "string" || out === undefined) throw new Error(out ?? "no pool");
      return [out, 0n, 0];
    },
  } as unknown as PublicClient;
  return { client, reads };
}

const swapAbi = parseAbi([
  "struct ExactInputSingleParams { address tokenIn; address tokenOut; int24 tickSpacing; address recipient; uint256 deadline; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }",
  "function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)",
]);

describe("Aero provider", () => {
  it("swaps through the pool that gives the most, with the minimum out from the slippage", async () => {
    const { client } = chain({ 10: pool10, 100: pool100 }, { [pool10]: 990n, [pool100]: 1_000n });
    const aero = createAero({ client, factory, swapRouter, metaQuoter, now: () => 1_800_000_000_000 });
    const q = await aero.quote({ tokenIn: usdc, tokenOut: nvda, amountIn: 5_000n, sender, slippageBps: 100 });
    expect(q.target).toBe(swapRouter);
    expect(q.amountOut).toBe(1_000n);
    const { args } = decodeFunctionData({ abi: swapAbi, data: q.data });
    expect(args[0]).toEqual({ tokenIn: usdc, tokenOut: nvda, tickSpacing: 100, recipient: sender, deadline: 1_800_000_120n, amountIn: 5_000n, amountOutMinimum: 990n, sqrtPriceLimitX96: 0n });
  });

  it("skips a pool whose quote reverts", async () => {
    const { client } = chain({ 10: pool10, 100: pool100 }, { [pool10]: 990n, [pool100]: "SPL" });
    expect(await createAero({ client, factory, swapRouter, metaQuoter }).price({ tokenIn: usdc, tokenOut: nvda, amountIn: 5_000n })).toBe(990n);
  });

  it("answers NO_ROUTE without a pool, or when no pool can fill", async () => {
    await expect(createAero({ client: chain({}, {}).client, factory, swapRouter, metaQuoter }).price({ tokenIn: usdc, tokenOut: nvda, amountIn: 1n })).rejects.toMatchObject({ code: "NO_ROUTE" });
    await expect(createAero({ client: chain({ 10: pool10 }, { [pool10]: 0n }).client, factory, swapRouter, metaQuoter }).price({ tokenIn: usdc, tokenOut: nvda, amountIn: 1n })).rejects.toMatchObject({ code: "NO_ROUTE" });
  });

  it("reads the pool list once per pair until the cache ends, in either direction", async () => {
    let t = 0;
    const { client, reads } = chain({ 10: pool10 }, { [pool10]: 5n });
    const aero = createAero({ client, factory, swapRouter, metaQuoter, poolCacheMs: 1_000, now: () => t });
    await aero.price({ tokenIn: usdc, tokenOut: nvda, amountIn: 1n });
    await aero.price({ tokenIn: nvda, tokenOut: usdc, amountIn: 1n });
    expect(reads.filter((r) => r === "getPool")).toHaveLength(7);
    t = 1_000;
    await aero.price({ tokenIn: usdc, tokenOut: nvda, amountIn: 1n });
    expect(reads.filter((r) => r === "getPool")).toHaveLength(14);
  });

  it("refuses a slippage of 100% or more", async () => {
    const { client } = chain({ 10: pool10 }, { [pool10]: 5n });
    await expect(createAero({ client, factory, swapRouter, metaQuoter }).quote({ tokenIn: usdc, tokenOut: nvda, amountIn: 1n, sender, slippageBps: 10_000 })).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
  });
});
