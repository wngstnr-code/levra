import { decodeFunctionData, getAddress, parseAbi, zeroAddress, type Address, type PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import { createUniswapV3 } from "../src/index";

const factory = getAddress("0x4b2ab38dbf28d31d467aa8993f6c2585981d6804");
const swapRouter02 = getAddress("0x4f0c28f5926afda16bf2506d5d9e57ea190f9bca");
const quoterV2 = getAddress("0xd1b797d92d87b688193a2b976efc8d577d204343");
const usdc = getAddress("0x00000000000000000000000000000000000a5dc0");
const qqq = getAddress("0x00000000000000000000000000000000000b0a00");
const sender = getAddress("0x00000000000000000000000000000000000ce751");
const pool500 = getAddress("0x00000000000000000000000000000000000a0500");
const pool3000 = getAddress("0x00000000000000000000000000000000000a3000");

/** A stand-in chain: pools by fee, and QuoterV2's answer per fee (a string makes it revert). */
function chain(pools: Record<number, Address>, outs: Record<number, bigint | string>) {
  const reads: string[] = [];
  const client = {
    async readContract({ functionName, args }: { functionName: string; args: readonly unknown[] }) {
      reads.push(functionName);
      if (functionName === "getPool") return pools[Number(args[2])] ?? zeroAddress;
      const out = outs[(args[0] as { fee: number }).fee];
      if (typeof out === "string" || out === undefined) throw new Error(out ?? "no pool");
      return [out, 0n, 0, 0n];
    },
  } as unknown as PublicClient;
  return { client, reads };
}

const swapAbi = parseAbi([
  "struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }",
  "function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)",
]);
const uniswap = (client: PublicClient, now = () => 0) => createUniswapV3({ client, factory, swapRouter02, quoterV2, now });

describe("Uniswap v3 provider", () => {
  it("swaps through the fee tier that gives the most, with the minimum out from the slippage", async () => {
    const { client } = chain({ 500: pool500, 3000: pool3000 }, { 500: 1_000n, 3000: 990n });
    const provider = uniswap(client);
    expect([provider.target, provider.spender]).toEqual([swapRouter02, swapRouter02]);
    const q = await provider.quote({ tokenIn: usdc, tokenOut: qqq, amountIn: 5_000n, sender, slippageBps: 100 });
    expect(q.amountOut).toBe(1_000n);
    const { functionName, args } = decodeFunctionData({ abi: swapAbi, data: q.data });
    expect(functionName).toBe("exactInputSingle");
    expect(args[0]).toEqual({ tokenIn: usdc, tokenOut: qqq, fee: 500, recipient: sender, amountIn: 5_000n, amountOutMinimum: 990n, sqrtPriceLimitX96: 0n });
  });

  it("skips a tier whose quote reverts or gives nothing", async () => {
    const { client } = chain({ 500: pool500, 3000: pool3000 }, { 500: "SPL", 3000: 0n });
    await expect(uniswap(client).price({ tokenIn: usdc, tokenOut: qqq, amountIn: 1n })).rejects.toMatchObject({ code: "NO_ROUTE" });
    const second = chain({ 500: pool500, 3000: pool3000 }, { 500: "SPL", 3000: 7n });
    expect(await uniswap(second.client).price({ tokenIn: usdc, tokenOut: qqq, amountIn: 1n })).toBe(7n);
  });

  it("answers NO_ROUTE without a pool, and reads the factory once per pair while the cache holds", async () => {
    await expect(uniswap(chain({}, {}).client).price({ tokenIn: usdc, tokenOut: qqq, amountIn: 1n })).rejects.toMatchObject({ code: "NO_ROUTE" });
    let t = 0;
    const { client, reads } = chain({ 500: pool500 }, { 500: 5n });
    const provider = uniswap(client, () => t);
    await provider.price({ tokenIn: usdc, tokenOut: qqq, amountIn: 1n });
    await provider.price({ tokenIn: qqq, tokenOut: usdc, amountIn: 1n });
    expect(reads.filter((r) => r === "getPool")).toHaveLength(4);
    t = 11 * 60_000;
    await provider.price({ tokenIn: usdc, tokenOut: qqq, amountIn: 1n });
    expect(reads.filter((r) => r === "getPool")).toHaveLength(8);
  });

  it("refuses a slippage of 100% or more", async () => {
    const { client } = chain({ 500: pool500 }, { 500: 5n });
    await expect(uniswap(client).quote({ tokenIn: usdc, tokenOut: qqq, amountIn: 1n, sender, slippageBps: 10_000 })).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
  });
});
