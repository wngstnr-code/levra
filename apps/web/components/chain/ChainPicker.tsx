"use client";

import { ChevronDown } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { erc20Abi } from "viem";
import { useAccount, useReadContracts } from "wagmi";
import { listedStocks, webChains, type WebChain } from "@/lib/chains";
import { useLiveChains } from "@/lib/api/hooks";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { formatToken } from "@/lib/units";
import { switchChainPath, useChain } from "@/lib/useChain";
import { Sheet } from "../ui/Sheet";

export const chainMark: Record<WebChain["slug"], string> = { monad: "bg-monad", base: "bg-base", xlayer: "bg-xlayer" };

export function ChainMark({ chain, className }: { chain: Pick<WebChain, "slug">; className?: string }) {
  return <span aria-hidden className={cn("inline-block shrink-0 rounded-[30%]", chainMark[chain.slug], className)} />;
}

/** The network button in the header. Every page and transaction follows the chosen network. */
export function ChainPicker({ className }: { className?: string }) {
  const m = useT();
  const chain = useChain();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={`${m.network.pick}: ${chain.name}`}
        className={cn("flex items-center gap-2 rounded-full bg-surface-1 py-1.5 pr-3 pl-1.5 text-sm font-semibold transition-colors hover:bg-surface-2", className)}
      >
        <ChainMark chain={chain} className="size-5" />
        {chain.name}
        <ChevronDown aria-hidden size={14} className="text-fg-2" />
      </button>
      <ChainSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function ChainSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const m = useT();
  const active = useChain();
  const router = useRouter();
  const pathname = usePathname();
  const { address } = useAccount();
  const balances = useReadContracts({
    contracts: webChains.map((c) => ({ address: c.usdc.address, abi: erc20Abi, functionName: "balanceOf" as const, args: [address!] as const, chainId: c.id })),
    query: { enabled: open && !!address },
  });
  const pick = (c: WebChain) => {
    onClose();
    if (c.id !== active.id) router.push(switchChainPath(pathname, c));
  };
  const live = useLiveChains();
  return (
    <Sheet open={open} onClose={onClose} title={m.network.title}>
      <ul className="space-y-1">
        {webChains.map((c, i) => {
          const served = live === null || live.has(c.id);
          const on = c.id === active.id;
          const bal = balances.data?.[i];
          return (
            <li key={c.id}>
              <button
                onClick={() => pick(c)}
                aria-current={on ? "true" : undefined}
                className={cn("flex w-full items-center gap-3 rounded-panel p-3 text-left transition-colors", on ? "bg-surface-3" : "hover:bg-surface-3/60")}
              >
                <ChainMark chain={c} className="size-8" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{c.name}</span>
                  <span className="block text-xs text-fg-3">{served ? m.network.stocks(listedStocks(c).length) : m.network.noData}</span>
                </span>
                <span className="text-right">
                  {bal?.status === "success" && <span className="block font-mono text-xs">{m.network.balance(formatToken(bal.result, c.usdc.decimals, 2))}</span>}
                  {on && <span className="block text-xs text-up">{m.network.active}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-fg-3">{m.network.note}</p>
    </Sheet>
  );
}
