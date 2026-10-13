"use client";

import { tokens } from "@levra/shared/addresses";
import { erc20Abi, type Address } from "viem";
import { useBalance, useReadContract } from "wagmi";
import { monad } from "@/lib/chain";
import { formatUnitsFixed } from "@/lib/format";

const REFRESH_MS = 15_000;

export function Balances({ address }: { address: Address }) {
  const mon = useBalance({ address, chainId: monad.id, query: { refetchInterval: REFRESH_MS } });
  const usdc = useReadContract({
    address: tokens.USDC.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
    chainId: monad.id,
    query: { refetchInterval: REFRESH_MS },
  });

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
      <dt className="text-neutral-400">USDC</dt>
      <dd className="text-right tabular-nums">
        <BalanceValue value={usdc.data} decimals={tokens.USDC.decimals} isError={usdc.isError} />
      </dd>
      <dt className="text-neutral-400">MON</dt>
      <dd className="text-right tabular-nums">
        <BalanceValue value={mon.data?.value} decimals={monad.nativeCurrency.decimals} isError={mon.isError} />
      </dd>
    </dl>
  );
}

function BalanceValue({ value, decimals, isError }: { value: bigint | undefined; decimals: number; isError: boolean }) {
  if (isError) return <span className="text-red-400">Unavailable</span>;
  if (value === undefined) return <span className="text-neutral-500">Loading</span>;
  return <>{formatUnitsFixed(value, decimals, 4)}</>;
}
