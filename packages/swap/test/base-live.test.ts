import { baseExternal, baseTokens } from "@levra/shared/addresses";
import { baseDeployment } from "@levra/shared/deployments/base";
import { baseStocks } from "@levra/shared/markets";
import { createPublicClient, decodeAbiParameters, encodeFunctionData, erc20Abi, http, toHex, type Address, type Hex } from "viem";
import { base } from "viem/chains";
import { describe, expect, it } from "vitest";
import { createAero, createKyber, createOneInch, KYBER_BASE_URL, type SwapProvider } from "../src";

/**
 * BE-96 step 3: every Base provider's calldata, built for our router as sender and recipient, delivers its quote when
 * run on the live Base node inside `eth_simulateV1` (a fork cannot run B20 tokens, 07). Nothing is sent. Run with
 * BASE_LIVE=1; 1inch joins when ONEINCH_API_KEY is set. BASE_RPC_URL defaults to the public endpoint.
 */
const live = process.env.BASE_LIVE === "1";
const client = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org", { retryCount: 4, retryDelay: 2_000 }) });
const router = baseDeployment.router;
const usdc = baseTokens.USDC.address;
/** Holds plenty of USDC on Base; the simulation moves some to the router as the first call. */
const USDC_HOLDER = baseExternal.morpho;
const SPEND_USDC = BigInt(process.env.BASE_LIVE_USDC ?? "100") * 1_000_000n;
const SLIPPAGE_BPS = 100;

function providers(): SwapProvider[] {
  const key = process.env.ONEINCH_API_KEY;
  return [
    createKyber({ baseUrl: KYBER_BASE_URL, clientId: "levra" }),
    ...(key ? [createOneInch({ chainId: 8453, apiKey: key, router: baseExternal.oneInchRouter })] : []),
    createAero({ client: client as never, factory: baseExternal.aeroClFactory, swapRouter: baseExternal.aeroSwapRouter, metaQuoter: baseExternal.aeroMetaQuoter }),
  ];
}

type Call = { from: Address; to: Address; data: Hex; gas: Hex };
type CallResult = { status: Hex; returnData: Hex; gasUsed: Hex; error?: { message?: string } };

const call = (from: Address, to: Address, data: Hex, gas = 3_000_000n): Call => ({ from, to, data, gas: toHex(gas) });
const transfer = (token: Address, from: Address, to: Address, amount: bigint) => call(from, token, encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }), 300_000n);
const approve = (token: Address, spender: Address, amount: bigint) => call(router, token, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }), 300_000n);
const balanceOf = (token: Address) => call(router, token, encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [router] }), 100_000n);

async function simulate(calls: Call[]): Promise<CallResult[]> {
  // The router's code is cleared for the simulation, so it can be the sender of plain calls (EIP-3607). Its address,
  // and so every issuer policy that names it, stays the same.
  const params = [{ blockStateCalls: [{ stateOverrides: { [router]: { code: "0x" } }, calls }], validation: false }, "latest"];
  const blocks = (await client.request({ method: "eth_simulateV1", params } as never)) as { calls: CallResult[] }[];
  return blocks[0]!.calls;
}

const amount = (r: CallResult) => decodeAbiParameters([{ type: "uint256" }], r.returnData)[0];
const ok = (r: CallResult, what: string) => {
  if (r.status !== "0x1") throw new Error(`${what} failed: ${r.error?.message ?? ""} ${r.returnData}`);
};

describe.skipIf(!live)("Base swap calldata in a live simulation (BE-96)", () => {
  for (const provider of providers()) {
    for (const stock of Object.values(baseStocks)) {
      it(`${provider.name}: buys and sells ${stock.symbol} for the router at the quoted amounts`, { timeout: 120_000 }, async () => {
        const buy = await provider.quote({ tokenIn: usdc, tokenOut: stock.token, amountIn: SPEND_USDC, sender: router, slippageBps: SLIPPAGE_BPS });
        // Sell a bit less than the buy should give, so the sell never asks for more than the router holds.
        const sellIn = (buy.amountOut * 95n) / 100n;
        const sell = await provider.quote({ tokenIn: stock.token, tokenOut: usdc, amountIn: sellIn, sender: router, slippageBps: SLIPPAGE_BPS });
        expect(buy.target).toBe(provider.target);
        expect(sell.target).toBe(provider.target);

        const r = await simulate([
          transfer(usdc, USDC_HOLDER, router, SPEND_USDC),
          approve(usdc, provider.spender, SPEND_USDC),
          call(router, buy.target, buy.data),
          balanceOf(stock.token),
          approve(stock.token, provider.spender, sellIn),
          call(router, sell.target, sell.data),
          balanceOf(usdc),
        ]);
        ["fund the router", "approve USDC", "buy", "stock balance", "approve the stock", "sell", "USDC balance"].forEach((what, i) => ok(r[i]!, what));

        const bought = amount(r[3]!);
        const received = amount(r[6]!);
        const bps = (got: bigint, quoted: bigint) => Number(((got - quoted) * 10_000n) / quoted);
        console.log(`${provider.name} ${stock.symbol}: bought ${bought} for quote ${buy.amountOut} (${bps(bought, buy.amountOut)} bps), sold for ${received} against ${sell.amountOut} (${bps(received, sell.amountOut)} bps), gas ${BigInt(r[2]!.gasUsed)} and ${BigInt(r[5]!.gasUsed)}`);
        // The router's minOut is the quote less the slippage, so the delivered amount must clear it.
        expect(bought * 10_000n >= buy.amountOut * BigInt(10_000 - SLIPPAGE_BPS)).toBe(true);
        expect(received * 10_000n >= sell.amountOut * BigInt(10_000 - SLIPPAGE_BPS)).toBe(true);
      });
    }
  }
});
