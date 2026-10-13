"use client";

import { anchoredStockOracleAbi } from "@levra/shared/abis";
import { external } from "@levra/shared/addresses";
import { stocks, type Stock } from "@levra/shared/markets";
import { useReadContracts } from "wagmi";
import { monad } from "@/lib/chain";
import { formatAge, formatUsdE8 } from "@/lib/format";
import { sessionFromIndex } from "@/lib/session";
import { useNowSeconds } from "@/lib/useNow";
import { Button } from "./ui/Button";
import { SessionBadge } from "./ui/SessionBadge";

const REFRESH_MS = 10_000;
const stockList: Stock[] = Object.values(stocks);

export function OracleMarkets() {
  const { data, isPending, isError, refetch, isFetching } = useReadContracts({
    contracts: stockList.map((stock) => ({
      address: external.anchoredStockOracle,
      abi: anchoredStockOracleAbi,
      functionName: "latestPrice",
      args: [stock.priceId],
      chainId: monad.id,
    })),
    query: { refetchInterval: REFRESH_MS },
  });
  const now = useNowSeconds();

  if (isError) {
    return (
      <div className="squircle flex items-center gap-4 rounded-card bg-surface-1 p-7">
        <p className="flex-1 text-[15px] text-fg-2">Could not read prices from Monad. Your funds are not affected.</p>
        <Button variant="secondary" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? "Retrying" : "Try again"}
        </Button>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto squircle rounded-card bg-surface-1">
      <table className="w-full text-sm">
        <thead className="text-left text-fg-3">
          <tr>
            <th className="px-7 pt-5 pb-3 label-caps">Stock</th>
            <th className="px-7 pt-5 pb-3 label-caps text-right">Price</th>
            <th className="px-7 pt-5 pb-3 label-caps text-right">Bid / Ask</th>
            <th className="px-7 pt-5 pb-3 label-caps">Session</th>
            <th className="px-7 pt-5 pb-3 label-caps text-right" title="Time since the source quote">
              Quote age
            </th>
          </tr>
        </thead>
        <tbody>
          {stockList.map((stock, i) => {
            const result = data?.[i];
            return (
              <tr key={stock.symbol} className="border-t border-line">
                <td className="px-7 py-4">
                  <div className="font-medium">{stock.tokenSymbol}</div>
                  <div className="text-xs text-fg-2">{stock.name}</div>
                </td>
                {isPending ? (
                  <td colSpan={4} className="px-7 py-4 text-fg-3">
                    Loading
                  </td>
                ) : result?.status !== "success" ? (
                  <td colSpan={4} className="px-7 py-4 text-down">
                    Price unavailable
                  </td>
                ) : (
                  <PriceCells payload={result.result} now={now} />
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type PricePayload = {
  price: bigint;
  bestBid: bigint;
  bestAsk: bigint;
  feedUpdateTimestamp: bigint;
  session: number;
};

function PriceCells({ payload, now }: { payload: PricePayload; now: number }) {
  const session = sessionFromIndex(payload.session);
  const hasBook = payload.bestBid > 0n && payload.bestAsk > 0n;
  const age = now - Number(payload.feedUpdateTimestamp);

  return (
    <>
      <td className="px-7 py-4 text-right font-medium tabular-nums">{formatUsdE8(payload.price)}</td>
      <td className="px-7 py-4 text-right tabular-nums text-fg-2">
        {hasBook ? `${formatUsdE8(payload.bestBid)} / ${formatUsdE8(payload.bestAsk)}` : "No quote"}
      </td>
      <td className="px-7 py-4">
        <SessionBadge session={session} />
      </td>
      <td className="px-7 py-4 text-right tabular-nums text-fg-2">{formatAge(age)}</td>
    </>
  );
}
