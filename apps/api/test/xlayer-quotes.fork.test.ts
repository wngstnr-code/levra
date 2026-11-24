import { xlayerExternal, xlayerTokens } from "@levra/shared/addresses";
import { morphoAbi } from "@levra/shared/abis";
import {
  quoteCloseResponse,
  quoteOpenResponse,
  type QuoteCloseResponse,
  type QuoteOpenResponse,
} from "@levra/shared/api";
import { xlayerDeployment } from "@levra/shared/deployments/xlayer";
import { xlayerStocks, type XLayerStockSymbol } from "@levra/shared/markets";
import type { SwapProvider } from "@levra/swap";
import pino from "pino";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  http,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { xLayer } from "viem/chains";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createChainReader } from "../src/chain/reader";
import {
  allowedProviders,
  routeForRouter,
  swapProviders,
} from "../src/chain/swap";

/**
 * BE-81: X Layer long and short quotes from the API, executed on an anvil fork of X Layer (no `eth_simulateV1` there;
 * the xStocks are plain ERC-20 tokens, so a fork runs them). Start `anvil --fork-url https://xlayerrpc.okx.com
 * --block-time 1` and run with XLAYER_FORK_RPC_URL; OKX joins with OKX_API_KEY, OKX_SECRET_KEY and OKX_API_PASSPHRASE
 * (from the VPS, 05). One second blocks keep the fork's latest block time near the clock, as on the live chain.
 * The feeds stop on the fork, and an open needs a feed younger than the market's maxOracleAge (30 minutes), so the
 * tests must run within 30 minutes of starting anvil, outside the weekly close.
 */
const forkUrl = process.env.XLAYER_FORK_RPC_URL;
/**
 * Like the API's own client, but a fork fetches every account it has not touched yet from the X Layer RPC first,
 * which can take far longer than the API's 15 s on a busy public endpoint.
 */
const FORK_REQUEST_TIMEOUT_MS = 120_000;
const forkTransport = () =>
  http(forkUrl ?? "http://127.0.0.1:8545", {
    timeout: FORK_REQUEST_TIMEOUT_MS,
    retryCount: 2,
  });
const client = createPublicClient({
  chain: xLayer,
  batch: { multicall: true },
  transport: forkTransport(),
}) as PublicClient;
const wallet = createWalletClient({ transport: forkTransport() });
const morpho = xlayerExternal.morpho;
const usdc = xlayerTokens.USDC.address;
const router = xlayerDeployment.router;
const USER = "0x00000000000000000000000000000000ce751d04" as Address;
const LENDER = "0x00000000000000000000000000000000ce751d05" as Address;
/** Holds plenty of USDC and of every wrapped xStock (the long markets' collateral) on X Layer. */
const HOLDER = morpho;
const MARGIN = 100_000_000n;
const SLIPPAGE_BPS = 100;
const HOOK_TIMEOUT_MS = 180_000;

const rpc = (method: string, params: unknown[]) =>
  client.request({ method: method as never, params: params as never });
const bps = (got: bigint, want: bigint) =>
  want === 0n ? 0 : Number(((got - want) * 10_000n) / want);
const balance = (token: Address, who: Address) =>
  client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [who],
  });

async function send(
  from: Address,
  to: Address,
  data: Hex,
  gas = 3_000_000n,
): Promise<bigint> {
  await rpc("anvil_impersonateAccount", [from]);
  await rpc("anvil_setBalance", [from, toHex(10n ** 19n)]);
  const hash = await wallet.sendTransaction({
    account: from,
    to,
    data,
    gas,
    chain: null,
  });
  // viem's default wait follows X Layer's 1 s blocks; a fork may first fetch the state the transaction touches.
  const receipt = await client.waitForTransactionReceipt({
    hash,
    timeout: FORK_REQUEST_TIMEOUT_MS,
  });
  if (receipt.status !== "success") {
    // Replayed on the state before the failed block, which gives the revert reason the receipt lacks.
    const reason = await client
      .call({
        account: from,
        to,
        data,
        gas,
        blockNumber: receipt.blockNumber - 1n,
      })
      .then(
        () => "no revert on replay",
        (err: Error) =>
          err.message
            .split("\n")
            .filter((l) => l.trim())
            .slice(0, 4)
            .join(" | "),
      );
    throw new Error(`call to ${to} from ${from} reverted: ${reason}`);
  }
  return receipt.gasUsed;
}

const erc20 = (
  functionName: "transfer" | "approve",
  to: Address,
  amount: bigint,
) => encodeFunctionData({ abi: erc20Abi, functionName, args: [to, amount] });

/** The API's providers on X Layer: Uniswap, and OKX first when its keys are set. */
async function providers(): Promise<SwapProvider[]> {
  const {
    OKX_API_KEY: apiKey,
    OKX_SECRET_KEY: secretKey,
    OKX_API_PASSPHRASE: passphrase,
  } = process.env;
  return swapProviders(196, client, {
    kyberClientId: "levra",
    okx:
      apiKey && secretKey && passphrase
        ? { apiKey, secretKey, passphrase }
        : undefined,
  });
}

/** `LENDER` supplies `amount` of the market's loan token to Morpho. */
async function supply(marketId: Hex, amount: bigint) {
  const p = await client.readContract({
    address: morpho,
    abi: morphoAbi,
    functionName: "idToMarketParams",
    args: [marketId],
  });
  await send(HOLDER, p.loanToken, erc20("transfer", LENDER, amount));
  await send(LENDER, p.loanToken, erc20("approve", morpho, amount));
  await send(
    LENDER,
    morpho,
    encodeFunctionData({
      abi: morphoAbi,
      functionName: "supply",
      args: [p, amount, 0n, LENDER, "0x"],
    }),
  );
}

describe.skipIf(!forkUrl)(
  "X Layer quotes executed on a fork (BE-81)",
  async () => {
    const stock =
      xlayerStocks[
        (process.env.XLAYER_FORK_STOCK ?? "QQQ") as XLayerStockSymbol
      ];
    const list = forkUrl ? await providers() : [];
    const app = createApp({
      logger: pino({ level: "silent" }),
      reader: createChainReader(client, xlayerDeployment),
      swap: routeForRouter(client, router, list) ?? undefined,
      events: { forUser: async () => [] },
    });

    async function request<T>(
      path: string,
      body: unknown,
      parse: (b: unknown) => T,
    ): Promise<T> {
      const res = await app.request(`/v1/196${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (res.status !== 200)
        throw new Error(
          `${path} answered ${res.status}: ${JSON.stringify(json)}`,
        );
      return parse(json);
    }

    let snapshot: Hex;
    beforeEach(async () => {
      snapshot = (await rpc("evm_snapshot", [])) as Hex;
    }, HOOK_TIMEOUT_MS);
    afterEach(async () => {
      await rpc("evm_revert", [snapshot]);
    }, HOOK_TIMEOUT_MS);

    it(
      "lists the providers the router accepts",
      { timeout: 60_000 },
      async () => {
        const allowed = await allowedProviders(client, router, list);
        console.log(
          `providers: ${list.map((p) => p.name).join(", ")}; the router accepts ${allowed.map((p) => p.name).join(", ")}`,
        );
        expect(allowed.length).toBeGreaterThan(0);
      },
    );

    const cases = [
      { side: "long" as const, leverageE2: 150, liquidity: 1_000_000_000n },
      // A short borrows the stock, so its market needs stock supplied: one wrapped share (18 decimals).
      { side: "short" as const, leverageE2: 70, liquidity: 10n ** 18n },
    ];

    for (const c of cases) {
      it(
        `opens and closes a ${stock.symbol} ${c.side} at the quoted amounts`,
        { timeout: 300_000 },
        async () => {
          const market = xlayerDeployment.markets.find(
            (m) => m.symbol === stock.symbol && m.side === c.side,
          )!;
          await supply(market.marketId, c.liquidity);
          await send(HOLDER, usdc, erc20("transfer", USER, MARGIN * 3n));
          await send(USER, usdc, erc20("approve", router, MARGIN * 3n));
          // Morpho refuses to set an authorization twice ("already set"), which a case left over from a failed revert would.
          const authorized = await client.readContract({
            address: morpho,
            abi: morphoAbi,
            functionName: "isAuthorized",
            args: [USER, router],
          });
          if (!authorized) {
            await send(
              USER,
              morpho,
              encodeFunctionData({
                abi: morphoAbi,
                functionName: "setAuthorization",
                args: [router, true],
              }),
            );
          }

          const openBody = {
            user: USER,
            symbol: stock.symbol,
            side: c.side,
            marginRaw: MARGIN.toString(),
            leverageE2: c.leverageE2,
            slippageBps: SLIPPAGE_BPS,
          };
          // The quote's deadline is the block time at its start plus 120 s. A cold fork fetches every contract of the
          // swap route from the public RPC first, which took longer than that on the VPS, so a first quote warms it.
          const warmStart = Date.now();
          await app.request("/v1/196/quote/open", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(openBody),
          });
          const quoteStart = Date.now();
          const open: QuoteOpenResponse = await request(
            "/quote/open",
            openBody,
            quoteOpenResponse.parse,
          );
          console.log(
            `${stock.symbol} ${c.side} quote: warm-up ${Math.round((quoteStart - warmStart) / 1000)} s, quote ${Math.round((Date.now() - quoteStart) / 1000)} s`,
          );
          expect(open.requirements.every((r) => r.satisfied)).toBe(true);
          expect(open.warnings.filter((w) => w.severity === "block")).toEqual(
            [],
          );
          const openGas = await send(
            USER,
            open.tx.to,
            open.tx.data,
            BigInt(open.tx.gasLimit),
          );

          const pos = await client.readContract({
            address: morpho,
            abi: morphoAbi,
            functionName: "position",
            args: [market.marketId, USER],
          });
          const preview = BigInt(open.preview.collateralRaw);
          console.log(
            `${stock.symbol} ${c.side} open: collateral ${pos.collateral} vs preview ${preview} (${bps(pos.collateral, preview)} bps), gas ${openGas} of ${open.tx.gasLimit}`,
          );
          expect(pos.borrowShares > 0n).toBe(true);
          // The swap may fill anywhere above the quote less the slippage.
          expect(
            pos.collateral * 10_000n >= preview * BigInt(10_000 - SLIPPAGE_BPS),
          ).toBe(true);

          const closeBody = {
            user: USER,
            marketId: market.marketId,
            fractionWad: (10n ** 18n).toString(),
            slippageBps: SLIPPAGE_BPS,
          };
          const close: QuoteCloseResponse = await request(
            "/quote/close",
            closeBody,
            quoteCloseResponse.parse,
          );
          expect(close.warnings.filter((w) => w.severity === "block")).toEqual(
            [],
          );
          const before = await balance(usdc, USER);
          const closeGas = await send(
            USER,
            close.tx.to,
            close.tx.data,
            BigInt(close.tx.gasLimit),
          );
          const returned = (await balance(usdc, USER)) - before;
          const expected = BigInt(close.preview.returnedRaw);
          console.log(
            `${stock.symbol} ${c.side} close: returned ${returned} vs preview ${expected} (${bps(returned, expected)} bps), fees ${open.preview.feeRaw} + ${close.preview.feeRaw}, user stock left ${await balance(stock.token, USER)} (bought ${close.preview.stockAmountRaw}, repaid ${close.preview.debtRepaidRaw}), gas ${closeGas} of ${close.tx.gasLimit}`,
          );

          const after = await client.readContract({
            address: morpho,
            abi: morphoAbi,
            functionName: "position",
            args: [market.marketId, USER],
          });
          expect([after.borrowShares, after.collateral]).toEqual([0n, 0n]);
          expect(
            returned * 10_000n >= expected * BigInt(10_000 - SLIPPAGE_BPS),
          ).toBe(true);
          // The router ends every transaction with nothing (08).
          expect([
            await balance(usdc, router),
            await balance(stock.token, router),
          ]).toEqual([0n, 0n]);
        },
      );
    }
  },
);
