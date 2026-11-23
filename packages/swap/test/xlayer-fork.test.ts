import { xlayerExternal, xlayerTokens } from "@levra/shared/addresses";
import { xlayerDeployment } from "@levra/shared/deployments/xlayer";
import { createPublicClient, createWalletClient, encodeFunctionData, erc20Abi, http, parseAbi, toHex, type Address, type Hex } from "viem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createOkx, createUniswapV3, type SwapProvider } from "../src";

/**
 * BE-81: every X Layer provider's calldata, built for our router as sender and recipient, delivers its quote when our
 * router's address sends it on a fork of X Layer. The xStocks are plain ERC-20 tokens, so a fork runs them (unlike B20
 * on Base), and the X Layer RPC has no `eth_simulateV1`. Start `anvil --fork-url https://rpc.xlayer.tech` and run with
 * XLAYER_FORK_RPC_URL; OKX joins when OKX_API_KEY, OKX_SECRET_KEY and OKX_API_PASSPHRASE are set (from the VPS, 05).
 */
const forkUrl = process.env.XLAYER_FORK_RPC_URL;
const client = createPublicClient({ transport: http(forkUrl ?? "http://127.0.0.1:8545") });
const wallet = createWalletClient({ transport: http(forkUrl ?? "http://127.0.0.1:8545") });
const router = xlayerDeployment.router;
const usdc = xlayerTokens.USDC.address;
/** Holds plenty of USDC on X Layer; the fork moves some to the router. */
const USDC_HOLDER = xlayerExternal.morpho;
const SPEND_USDC = BigInt(process.env.XLAYER_FORK_USDC ?? "100") * 1_000_000n;
const SLIPPAGE_BPS = 100;
const routerAbi = parseAbi(["function factory() view returns (address)"]);

// The official Uniswap v3 QuoterV2 on X Layer (Uniswap/contracts, deployments/196.md). Its factory is SwapRouter02's.
// Belongs in `xlayerExternal` (Wangsit's file); asked in PROGRESS. Until then it lives only in this test.
const QUOTER_V2: Address = "0xD1b797D92d87B688193A2B976eFc8D577D204343";

async function providers(): Promise<SwapProvider[]> {
  const factory = await client.readContract({ address: xlayerExternal.uniswapSwapRouter02, abi: routerAbi, functionName: "factory" });
  const list: SwapProvider[] = [createUniswapV3({ client: client as never, factory, swapRouter02: xlayerExternal.uniswapSwapRouter02, quoterV2: QUOTER_V2 })];
  const { OKX_API_KEY: apiKey, OKX_SECRET_KEY: secretKey, OKX_API_PASSPHRASE: passphrase } = process.env;
  if (apiKey && secretKey && passphrase) {
    list.unshift(createOkx({ chainId: 196, apiKey, secretKey, passphrase, router: xlayerExternal.okxDexRouter, approve: xlayerExternal.okxDexApprove }));
  }
  return list;
}

const rpc = (method: string, params: unknown[]) => client.request({ method: method as never, params: params as never });
const erc20 = (functionName: "transfer" | "approve", to: Address, amount: bigint) => encodeFunctionData({ abi: erc20Abi, functionName, args: [to, amount] });

async function send(from: Address, to: Address, data: Hex): Promise<bigint> {
  const hash = await wallet.sendTransaction({ account: from, to, data, gas: 3_000_000n, chain: null });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`call to ${to} from ${from} reverted`);
  return receipt.gasUsed;
}
const balance = (token: Address) => client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [router] });

describe.skipIf(!forkUrl)("X Layer swap calldata on a fork (BE-81)", async () => {
  let snapshot: Hex;
  beforeEach(async () => {
    snapshot = (await rpc("evm_snapshot", [])) as Hex;
    // The router's code is cleared on the fork so its address can send plain calls; every token policy that names it stays.
    await rpc("anvil_setCode", [router, "0x"]);
    for (const who of [router, USDC_HOLDER]) {
      await rpc("anvil_impersonateAccount", [who]);
      await rpc("anvil_setBalance", [who, toHex(10n ** 19n)]);
    }
  });
  afterEach(async () => {
    await rpc("evm_revert", [snapshot]);
  });

  const list = forkUrl ? await providers() : [];
  for (const provider of list) {
    for (const [symbol, stock] of Object.entries(xlayerTokens).filter(([s]) => s !== "USDC")) {
      it(`${provider.name}: buys and sells ${symbol} for the router at the quoted amounts`, { timeout: 120_000 }, async (ctx) => {
        let buy;
        try {
          buy = await provider.quote({ tokenIn: usdc, tokenOut: stock.address, amountIn: SPEND_USDC, sender: router, slippageBps: SLIPPAGE_BPS });
        } catch (err) {
          // Uniswap has no USDC pool with depth for some xStocks (05); OKX routes those.
          if ((err as { code?: string }).code === "NO_ROUTE") return ctx.skip();
          throw err;
        }
        expect(buy.target).toBe(provider.target);

        await send(USDC_HOLDER, usdc, erc20("transfer", router, SPEND_USDC));
        await send(router, usdc, erc20("approve", provider.spender, SPEND_USDC));
        const buyGas = await send(router, buy.target, buy.data);
        const bought = await balance(stock.address);

        // Sell a bit less than the buy gave, so the sell never asks for more than the router holds.
        const sellIn = (bought * 95n) / 100n;
        const sell = await provider.quote({ tokenIn: stock.address, tokenOut: usdc, amountIn: sellIn, sender: router, slippageBps: SLIPPAGE_BPS });
        await send(router, stock.address, erc20("approve", provider.spender, sellIn));
        const sellGas = await send(router, sell.target, sell.data);
        const received = await balance(usdc);

        const bps = (got: bigint, quoted: bigint) => Number(((got - quoted) * 10_000n) / quoted);
        console.log(`${provider.name} ${symbol}: bought ${bought} for quote ${buy.amountOut} (${bps(bought, buy.amountOut)} bps), sold for ${received} against ${sell.amountOut} (${bps(received, sell.amountOut)} bps), gas ${buyGas} and ${sellGas}`);
        // The router's minOut is the quote less the slippage, so the delivered amount must clear it.
        expect(bought * 10_000n >= buy.amountOut * BigInt(10_000 - SLIPPAGE_BPS)).toBe(true);
        expect(received * 10_000n >= sell.amountOut * BigInt(10_000 - SLIPPAGE_BPS)).toBe(true);
      });
    }
  }
});
