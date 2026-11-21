import { morphoPositions } from "@levra/db";
import type { SwapSource } from "@levra/kyber";
import { lensAbi, liquidatorAbi, morphoAbi, sessionOracleAbi } from "@levra/shared/abis";
import { tokensByChain } from "@levra/shared/addresses";
import { isChainId, type ChainId } from "@levra/shared/chains";
import { findStock } from "@levra/shared/markets";
import type { Deployment } from "@levra/shared/deployments";
import { BPS, accrueBorrowAssets, maxSeizable, morphoIsHealthy, morphoRepaidCeiling, morphoRepaidForSeize, mulDiv, type MorphoTotals } from "@levra/shared/math";
import { getAddress, zeroAddress, type Account, type Address, type Chain, type Hex, type PublicClient, type Transport, type WalletClient } from "viem";
import { morphoOn } from "../chain";
import type { Job } from "../runner";

/** Monad charges the gas limit (02), so the margin over the estimate stays small. */
const GAS_MARGIN_PCT = 15n;
/** Halvings tried when the DEX cannot cover the debt for the full seizure. */
const MAX_HALVINGS = 4;
/** A short liquidation buys back the stock with part of the seized USDC; this is the first guess above the oracle value. */
const SHORT_BUY_BUFFER_BPS = 300n;
/**
 * Interest a liquidation is sized for beyond the block it was planned in: the time to land, with room to spare (BE-89).
 * Initial proposal. At 100% a year it adds about a millionth of the debt, while the repay ceiling it feeds moves by a wei.
 */
const ACCRUAL_MARGIN_SECONDS = 300n;

export type LiquidationPlan = {
  marketId: Hex;
  borrower: Address;
  seizedAssets: bigint;
  swapAmountIn: bigint;
  swap: { target: Address; data: Hex; minOut: bigint };
  repaidAssets: bigint;
};

export type LiquidatorOptions = {
  client: PublicClient;
  wallet: WalletClient<Transport, Chain, Account>;
  deployment: Deployment;
  swap: SwapSource;
  slippageBps?: number;
  intervalMs?: number;
};

/**
 * `totals` decide health and the seizure; `repaid` is what the swap must bring back for a seizure. A liquidator with a
 * loss budget (D-91) reverts on a single wei short, so it is sized with the accrued totals and a ceiling; the live Monad
 * liquidator has none and keeps the sizing it was tested with (BE-89).
 */
type MarketCtx = {
  market: Deployment["markets"][number];
  totals: MorphoTotals;
  price: bigint;
  priceE8: bigint;
  repaid: (seized: bigint) => bigint;
  /** USDC and the stock on this chain: Base stocks have 8 decimals, the others 18. */
  quoteDecimals: bigint;
  stockDecimals: bigint;
};

/**
 * Watches every borrower the indexer knows in our markets, including those who use Morpho directly, and liquidates a
 * position through `Liquidator` once it passes the hard limit (BE-32). It never asks the contract to cover a shortfall
 * from its own balance: the swap must pay the debt back, or the seizure is made smaller.
 */
export function createLiquidatorBot({ client, wallet, deployment, swap, slippageBps = 100, intervalMs = 10_000 }: LiquidatorOptions): Job {
  const liquidator = deployment.liquidator;
  const slip = BigInt(slippageBps);
  const morpho = morphoOn(deployment.chainId);
  if (!isChainId(deployment.chainId)) throw new Error(`Deployment is for chain ${deployment.chainId}, which has no addresses in packages/shared`);
  const chainId: ChainId = deployment.chainId;

  type LensMarket = { totalBorrowAssets: bigint; borrowRatePerSecond: bigint };

  async function marketCtx(market: Deployment["markets"][number], lens: Map<string, LensMarket> | null): Promise<MarketCtx | null> {
    const [m, price, snapshot] = await Promise.all([
      client.readContract({ address: morpho, abi: morphoAbi, functionName: "market", args: [market.marketId] }),
      // price() reverts when the oracle is stale; Morpho cannot liquidate then either.
      client.readContract({ address: market.oracle, abi: sessionOracleAbi, functionName: "price" }).catch(() => null),
      client.readContract({ address: market.oracle, abi: sessionOracleAbi, functionName: "snapshot" }).catch(() => null),
    ]);
    if (price === null || snapshot === null) return null;
    const lltv = BigInt(market.lltv);
    const stock = findStock(chainId, market.symbol);
    if (!stock) throw new Error(`${market.symbol} is not a stock on chain ${chainId}`);
    const decimals = { quoteDecimals: BigInt(tokensByChain[chainId].USDC.decimals), stockDecimals: BigInt(stock.decimals) };
    const stored = { totalBorrowAssets: m.totalBorrowAssets, totalBorrowShares: m.totalBorrowShares };
    if (!lens) return { market, totals: stored, price, priceE8: snapshot[0], ...decimals, repaid: (seized) => morphoRepaidForSeize(seized, stored, price, lltv).repaidAssets };

    const view = lens.get(market.marketId.toLowerCase());
    if (!view) throw new Error(`Lens does not list ${market.symbol} ${market.side}`);
    // Lens gives Morpho's expectedMarketBalances at the latest block; borrow shares do not change with interest.
    const totals = { totalBorrowAssets: view.totalBorrowAssets, totalBorrowShares: m.totalBorrowShares };
    const atLanding = { ...totals, totalBorrowAssets: accrueBorrowAssets(view.totalBorrowAssets, view.borrowRatePerSecond, ACCRUAL_MARGIN_SECONDS) };
    return { market, totals, price, priceE8: snapshot[0], ...decimals, repaid: (seized) => morphoRepaidCeiling(seized, atLanding, price, lltv) };
  }

  /** Whether the deployed liquidator has the loss budget (D-91). The live Monad one does not (BE-89). */
  async function hasLossBudget(): Promise<boolean> {
    return client.readContract({ address: liquidator!, abi: liquidatorAbi, functionName: "lossBudgetOf", args: [zeroAddress] }).then(
      () => true,
      () => false,
    );
  }

  async function plan(ctx: MarketCtx, borrower: Address, position: { collateral: bigint; borrowShares: bigint }): Promise<LiquidationPlan | string> {
    const { market, totals, price, priceE8 } = ctx;
    const lltv = BigInt(market.lltv);
    let seized = maxSeizable(position, totals, price, lltv);
    if (seized === 0n) return "nothing can be seized";

    for (let attempt = 0; attempt <= MAX_HALVINGS && seized > 0n; attempt++, seized /= 2n) {
      const repaidAssets = ctx.repaid(seized);
      if (market.side === "long") {
        // Sell the seized stock; the USDC must cover the repaid debt.
        const q = await swap.quote({ tokenIn: market.collateralToken, tokenOut: market.loanToken, amountIn: seized, sender: liquidator!, slippageBps });
        const minOut = (q.amountOut * (BPS - slip)) / BPS;
        if (minOut >= repaidAssets) return { marketId: market.marketId, borrower, seizedAssets: seized, swapAmountIn: seized, swap: { target: q.target, data: q.data, minOut }, repaidAssets };
        continue;
      }
      // Short: buy back the stock debt with part of the seized USDC, sized from the oracle price, then corrected once.
      let amountIn = (mulDiv(repaidAssets * priceE8, 10n ** ctx.quoteDecimals, 100_000_000n * 10n ** ctx.stockDecimals) * (BPS + SHORT_BUY_BUFFER_BPS)) / BPS;
      for (let fix = 0; fix < 3 && amountIn <= seized; fix++) {
        const q = await swap.quote({ tokenIn: market.collateralToken, tokenOut: market.loanToken, amountIn, sender: liquidator!, slippageBps });
        const minOut = (q.amountOut * (BPS - slip)) / BPS;
        if (minOut >= repaidAssets) return { marketId: market.marketId, borrower, seizedAssets: seized, swapAmountIn: amountIn, swap: { target: q.target, data: q.data, minOut }, repaidAssets };
        amountIn = minOut === 0n ? seized + 1n : (amountIn * repaidAssets * 101n) / (minOut * 100n);
      }
    }
    return "the DEX cannot cover the debt at any tried size";
  }

  return {
    name: "liquidator",
    intervalMs,
    async run({ db, chainId, logger }) {
      if (!liquidator) throw new Error("The deployment has no Liquidator");
      const keeper = await client.readContract({ address: liquidator, abi: liquidatorAbi, functionName: "isKeeper", args: [wallet.account.address] });
      if (!keeper) throw new Error(`Key ${wallet.account.address} is not a Liquidator keeper`);

      const ours = new Map(deployment.markets.map((m) => [m.marketId.toLowerCase(), m]));
      const borrowers = (await morphoPositions(db, chainId)).filter((p) => p.borrowShares > 0n && ours.has(p.marketId));
      const budgeted = borrowers.length > 0 && (await hasLossBudget());
      const lens = budgeted
        ? new Map(
            (await client.readContract({ address: deployment.lens, abi: lensAbi, functionName: "getMarkets" })).map((v) => [
              v.marketId.toLowerCase(),
              { totalBorrowAssets: v.totalBorrowAssets, borrowRatePerSecond: v.borrowRatePerSecond },
            ]),
          )
        : null;
      const contexts = new Map<string, MarketCtx | null>();
      const results: Record<string, unknown>[] = [];
      let unhealthy = 0;

      for (const candidate of borrowers) {
        const market = ours.get(candidate.marketId)!;
        if (!contexts.has(market.marketId)) contexts.set(market.marketId, await marketCtx(market, lens));
        const ctx = contexts.get(market.marketId);
        if (!ctx) continue;

        const borrower = getAddress(candidate.user);
        // The chain decides; the indexed position only says whom to look at.
        const onChain = await client.readContract({ address: morpho, abi: morphoAbi, functionName: "position", args: [market.marketId, borrower] });
        const position = { collateral: onChain.collateral, borrowShares: onChain.borrowShares };
        if (morphoIsHealthy(position, ctx.totals, ctx.price, BigInt(market.lltv))) continue;
        unhealthy += 1;

        const p = await plan(ctx, borrower, position);
        const entry = { symbol: market.symbol, side: market.side, borrower };
        if (typeof p === "string") {
          logger.warn({ ...entry, reason: p }, "unhealthy position not liquidated");
          results.push({ ...entry, skipped: p });
          continue;
        }
        const request = {
          address: liquidator,
          abi: liquidatorAbi,
          functionName: "liquidate",
          args: [p.marketId, p.borrower, p.seizedAssets, p.swapAmountIn, p.swap, 0n, 0n],
        } as const;
        const gas = await client.estimateContractGas({ ...request, account: wallet.account });
        const hash = await wallet.writeContract({ ...request, gas: gas + (gas * GAS_MARGIN_PCT) / 100n });
        const receipt = await client.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error(`liquidate reverted for ${borrower} in ${market.symbol} ${market.side}: ${hash}`);
        logger.warn({ ...entry, seized: p.seizedAssets.toString(), repaid: p.repaidAssets.toString(), tx: hash }, "position liquidated");
        results.push({ ...entry, seized: p.seizedAssets.toString(), tx: hash });
      }
      return { borrowers: borrowers.length, unhealthy, actions: results };
    },
  };
}
