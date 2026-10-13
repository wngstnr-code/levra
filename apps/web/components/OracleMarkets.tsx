"use client";

import { anchoredStockOracleAbi } from "@levra/shared/abis";
import { external } from "@levra/shared/addresses";
import { stocks, type Stock } from "@levra/shared/markets";
import { useReadContracts } from "wagmi";
import { monad } from "@/lib/chain";
import { formatAge, formatUsdE8 } from "@/lib/format";
import { sessionFromIndex, sessionLabel, sessionTone } from "@/lib/session";
import { useNowSeconds } from "@/lib/useNow";

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
      <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-sm">
        <p className="text-red-300">Could not read prices from Monad.</p>
        <button onClick={() => refetch()} disabled={isFetching} className="mt-2 underline disabled:opacity-60">
          {isFetching ? "Retrying" : "Try again"}
        </button>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-neutral-800">
      <table className="w-full text-sm">
        <thead className="bg-neutral-900 text-left text-neutral-400">
          <tr>
            <th className="px-4 py-2 font-medium">Stock</th>
            <th className="px-4 py-2 text-right font-medium">Price</th>
            <th className="px-4 py-2 text-right font-medium">Bid / Ask</th>
            <th className="px-4 py-2 font-medium">Session</th>
            <th className="px-4 py-2 text-right font-medium" title="Time since the source quote">
              Quote age
            </th>
          </tr>
        </thead>
        <tbody>
          {stockList.map((stock, i) => {
            const result = data?.[i];
            return (
              <tr key={stock.symbol} className="border-t border-neutral-800">
                <td className="px-4 py-3">
                  <div className="font-medium">{stock.tokenSymbol}</div>
                  <div className="text-xs text-neutral-400">{stock.name}</div>
                </td>
                {isPending ? (
                  <td colSpan={4} className="px-4 py-3 text-neutral-500">
                    Loading
                  </td>
                ) : result?.status !== "success" ? (
                  <td colSpan={4} className="px-4 py-3 text-red-300">
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
      <td className="px-4 py-3 text-right font-medium tabular-nums">{formatUsdE8(payload.price)}</td>
      <td className="px-4 py-3 text-right tabular-nums text-neutral-300">
        {hasBook ? `${formatUsdE8(payload.bestBid)} / ${formatUsdE8(payload.bestAsk)}` : "No quote"}
      </td>
      <td className="px-4 py-3">
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${sessionTone[session]}`}>{sessionLabel[session]}</span>
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-neutral-300">{formatAge(age)}</td>
    </>
  );
}
