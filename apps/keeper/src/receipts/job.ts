import { morphoEvents, receiptKeys, routerEvents, tapesendOutbox, type Db } from "@levra/db";
import { byChainOrder, entryPriceE8, positionCloses, type PositionClose, type StoredEvent } from "@levra/positions";
import { chains } from "@levra/shared/chains";
import type { Deployment, DeployedMarket } from "@levra/shared/deployments";
import { pnlBps } from "@levra/shared/math";
import type { Content } from "@levra/tapeout";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { erc20Abi, formatUnits, type Hex, type PublicClient } from "viem";
import type { Job } from "../runner";

const REASON_PROTECTION = 1;
/** Closes older than this get no receipt, so a keeper that was down catches up for three days and no further. */
const LOOKBACK_MS = 3 * 86_400_000;

/** Rounds half up to cents in bigint, so a large amount keeps every digit. */
const usd = (raw: bigint, decimals: number) => {
  const scale = 10n ** BigInt(decimals);
  const cents = ((raw < 0n ? -raw : raw) * 100n + scale / 2n) / scale;
  return `${raw < 0n ? "-" : ""}$${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
};
const price = (e8: bigint) => `$${formatUnits(e8, 8)}`;
const percent = (bps: number) => `${bps >= 0 ? "+" : ""}${(bps / 100).toFixed(2)}%`;

/**
 * The receipt of one close: what TapeSend carries to the wallet (D-113). The text reads on its own in any TapeSend
 * client; `levra` holds the same facts as strings for the app. Amounts are in USDC (6 decimals on our chains).
 */
export function closeReceipt(close: PositionClose, market: DeployedMarket, decimals: { usdc: number; stock: number }, chainId: number): Content {
  const entry = entryPriceE8(close.before, decimals.usdc, decimals.stock);
  const bps = pnlBps(close.realized, close.marginOut);
  const by = close.reason === REASON_PROTECTION ? "Closed by protection before the market close." : "Closed by you.";
  const lines = [
    `${market.symbol} ${market.side} closed on ${chains[chainId as keyof typeof chains]?.name ?? `chain ${chainId}`}. ${by}`,
    `Entry: ${entry > 0n ? price(entry) : "not known (opened outside Levra)"}`,
    `Exit: ${price(close.exitPriceE8)}`,
    `Profit or loss: ${usd(close.realized, decimals.usdc)}${bps === null ? "" : ` (${percent(bps)} of the margin)`}`,
    `Transaction: ${close.txHash}`,
  ];
  return {
    subject: `${market.symbol} ${market.side} closed: ${bps === null ? usd(close.realized, decimals.usdc) : percent(bps)}`,
    body: lines.join("\n"),
    ts: close.blockTime * 1000,
    levra: {
      type: "close",
      chainId,
      marketId: market.marketId,
      symbol: market.symbol,
      side: market.side,
      entryPriceE8: entry.toString(),
      exitPriceE8: close.exitPriceE8.toString(),
      realizedUsdRaw: close.realized.toString(),
      marginUsdRaw: close.marginOut.toString(),
      pnlBps: bps,
      reason: close.reason,
      txHash: close.txHash,
    },
  };
}

async function userEvents(db: Db, chainId: number, user: string): Promise<StoredEvent[]> {
  const [router, morpho] = await Promise.all([
    db.select().from(routerEvents).where(and(eq(routerEvents.chainId, chainId), eq(routerEvents.user, user))).orderBy(asc(routerEvents.blockNumber), asc(routerEvents.logIndex)),
    db.select().from(morphoEvents).where(and(eq(morphoEvents.chainId, chainId), eq(morphoEvents.user, user))).orderBy(asc(morphoEvents.blockNumber), asc(morphoEvents.logIndex)),
  ]);
  const toStored = (source: "router" | "morpho") => (r: (typeof router)[number] | (typeof morpho)[number]): StoredEvent => ({
    source,
    name: r.name,
    marketId: r.marketId as Hex,
    txHash: r.txHash as Hex,
    logIndex: r.logIndex,
    blockNumber: r.blockNumber,
    blockTime: Math.floor(r.blockTime.getTime() / 1000),
    args: r.args,
  });
  return [...router.map(toStored("router")), ...morpho.map(toStored("morpho"))].sort(byChainOrder);
}

export const receiptKey = (chainId: number, c: Pick<PositionClose, "txHash" | "logIndex">) => `${chainId}:close:${c.txHash.toLowerCase()}:${c.logIndex}`;

/**
 * Queues a receipt for every position closed through the router on this chain by a wallet with a receipt key (BE-84),
 * from the time the key was registered. The TapeSend sender in the X Layer keeper sends them; every chain's keeper
 * queues its own closes (D-87), and Levra pays the OKB.
 */
export function createReceipts({ client, deployment, intervalMs = 60_000 }: { client: PublicClient; deployment: Deployment; intervalMs?: number }): Job {
  const markets = new Map(deployment.markets.map((m) => [m.marketId.toLowerCase(), m]));
  const decimals = new Map<string, number>();
  const decimalsOf = async (token: Hex) => {
    const k = token.toLowerCase();
    if (!decimals.has(k)) decimals.set(k, await client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }));
    return decimals.get(k)!;
  };

  return {
    name: "receipts",
    intervalMs,
    async run({ db, chainId }) {
      const keys = await db.select().from(receiptKeys);
      if (keys.length === 0) return { wallets: 0, queued: 0 };
      // Partial reductions match too and are looked at again each run, so the window stays short.
      const floor = Date.now() - LOOKBACK_MS;
      const since = new Map(keys.map((k) => [k.address, Math.max(k.createdAt.getTime(), floor)]));
      const earliest = new Date(Math.min(...since.values()));
      const reductions = await db
        .select({ user: routerEvents.user, txHash: routerEvents.txHash, logIndex: routerEvents.logIndex, blockTime: routerEvents.blockTime })
        .from(routerEvents)
        .where(and(eq(routerEvents.chainId, chainId), eq(routerEvents.name, "PositionReduced"), inArray(routerEvents.user, [...since.keys()]), gte(routerEvents.blockTime, earliest)));
      const fresh = reductions.filter((r) => r.blockTime.getTime() >= since.get(r.user)!);
      if (fresh.length === 0) return { wallets: keys.length, queued: 0 };

      const queuedRows = await db
        .select({ address: tapesendOutbox.address, key: tapesendOutbox.key })
        .from(tapesendOutbox)
        .where(inArray(tapesendOutbox.address, [...new Set(fresh.map((r) => r.user))]));
      const queuedKeys = new Set(queuedRows.map((r) => `${r.address} ${r.key}`));
      const todo = fresh.filter((r) => !queuedKeys.has(`${r.user} ${receiptKey(chainId, { txHash: r.txHash as Hex, logIndex: r.logIndex })}`));

      let queued = 0;
      for (const user of new Set(todo.map((r) => r.user))) {
        const wanted = new Set(todo.filter((r) => r.user === user).map((r) => `${r.txHash.toLowerCase()}:${r.logIndex}`));
        const closes = positionCloses(await userEvents(db, chainId, user), (id) => markets.get(id)?.side).filter((c) => wanted.has(`${c.txHash.toLowerCase()}:${c.logIndex}`));
        for (const close of closes) {
          const market = markets.get(close.marketId.toLowerCase())!;
          const [stock, quote] = market.side === "long" ? [market.collateralToken, market.loanToken] : [market.loanToken, market.collateralToken];
          const content = closeReceipt(close, market, { usdc: await decimalsOf(quote), stock: await decimalsOf(stock) }, chainId);
          const inserted = await db
            .insert(tapesendOutbox)
            .values({ address: user, key: receiptKey(chainId, close), subject: content.subject, body: content.body, levra: content.levra ?? {}, eventAt: new Date(content.ts), createdAt: new Date() })
            .onConflictDoNothing()
            .returning({ key: tapesendOutbox.key });
          queued += inserted.length;
        }
      }
      return { wallets: keys.length, queued };
    },
  };
}
