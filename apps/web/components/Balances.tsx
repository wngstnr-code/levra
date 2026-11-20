"use client";

import { erc20Abi, type Address } from "viem";
import { useBalance, useReadContract } from "wagmi";
import { formatUnitsFixed } from "@/lib/format";
import { useChain } from "@/lib/useChain";

const REFRESH_MS = 15_000;

export function Balances({ address }: { address: Address }) {
  const chain = useChain();
  const mon = useBalance({ address, chainId: chain.id, query: { refetchInterval: REFRESH_MS } });
  const usdc = useReadContract({
    address: chain.usdc.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
    chainId: chain.id,
    query: { refetchInterval: REFRESH_MS },
  });

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      <dt className="text-fg-2">USDC</dt>
      <dd className="text-right tabular-nums">
        <BalanceValue value={usdc.data} decimals={chain.usdc.decimals} isError={usdc.isError} />
      </dd>
      <dt className="text-fg-2">MON</dt>
      <dd className="text-right tabular-nums">
        <BalanceValue value={mon.data?.value} decimals={chain.viem.nativeCurrency.decimals} isError={mon.isError} />
      </dd>
    </dl>
  );
}

function BalanceValue({ value, decimals, isError }: { value: bigint | undefined; decimals: number; isError: boolean }) {
  if (isError) return <span className="text-down">Unavailable</span>;
  if (value === undefined) return <span className="text-fg-3">Loading</span>;
  return <>{formatUnitsFixed(value, decimals, 4)}</>;
}
