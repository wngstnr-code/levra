"use client";

import { useExportWallet, usePrivy } from "@privy-io/react-auth";
import { useEffect } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { monad } from "@/lib/chain";
import { shortAddress } from "@/lib/format";
import { privyAppId } from "@/lib/privy";
import { Balances } from "./Balances";

export function WalletButton() {
  if (!privyAppId) {
    return (
      <span className="text-sm text-neutral-500" title="NEXT_PUBLIC_PRIVY_APP_ID is not set">
        Sign-in unavailable
      </span>
    );
  }
  return <PrivyWalletButton />;
}

function PrivyWalletButton() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { exportWallet } = useExportWallet();
  const { address, chainId, isConnected } = useAccount();
  const { switchChain, isPending: isSwitching, error: switchError } = useSwitchChain();

  const onWrongChain = isConnected && chainId !== monad.id;

  useEffect(() => {
    if (onWrongChain) switchChain({ chainId: monad.id });
  }, [onWrongChain, switchChain]);

  if (!ready) {
    return <span className="text-sm text-neutral-500">Loading</span>;
  }

  if (!authenticated) {
    return (
      <button onClick={login} className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-neutral-950 hover:bg-neutral-200">
        Sign in
      </button>
    );
  }

  if (!address) {
    return <span className="text-sm text-neutral-500">Connecting wallet</span>;
  }

  if (onWrongChain) {
    return (
      <button
        onClick={() => switchChain({ chainId: monad.id })}
        disabled={isSwitching}
        className="rounded-md bg-amber-400 px-3 py-1.5 text-sm font-medium text-neutral-950 disabled:opacity-60"
        title={switchError?.message}
      >
        {isSwitching ? "Switching to Monad" : "Switch to Monad"}
      </button>
    );
  }

  const hasEmbeddedWallet = user?.wallet?.walletClientType === "privy";

  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-md border border-neutral-700 px-3 py-1.5 text-sm tabular-nums hover:border-neutral-500">
        {shortAddress(address)}
      </summary>
      <div className="absolute right-0 z-10 mt-2 w-64 space-y-3 rounded-md border border-neutral-800 bg-neutral-900 p-4 shadow-lg">
        <p className="break-all text-xs text-neutral-400">{address}</p>
        <Balances address={address} />
        <div className="flex flex-col gap-2 border-t border-neutral-800 pt-3 text-sm">
          {hasEmbeddedWallet && (
            <button onClick={() => exportWallet({ address })} className="text-left text-neutral-300 hover:text-white">
              Export wallet key
            </button>
          )}
          <button onClick={logout} className="text-left text-neutral-300 hover:text-white">
            Sign out
          </button>
        </div>
      </div>
    </details>
  );
}
