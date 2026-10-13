"use client";

import { useExportWallet, usePrivy } from "@privy-io/react-auth";
import { useEffect, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { monad } from "@/lib/chain";
import { shortAddress } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { trackStep } from "@/lib/metrics";
import { privyAppId } from "@/lib/privy";
import { Balances } from "./Balances";
import { Button } from "./ui/Button";

export function WalletButton() {
  const m = useT();
  if (!privyAppId) {
    return (
      <span className="text-sm text-fg-3" title="NEXT_PUBLIC_PRIVY_APP_ID is not set">
        {m.wallet.unavailable}
      </span>
    );
  }
  return <PrivyWalletButton />;
}

function PrivyWalletButton() {
  const m = useT();
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { exportWallet } = useExportWallet();
  const { address, chainId, isConnected } = useAccount();
  const { switchChain, isPending: isSwitching, error: switchError } = useSwitchChain();

  const onWrongChain = isConnected && chainId !== monad.id;

  useEffect(() => {
    if (onWrongChain) switchChain({ chainId: monad.id });
  }, [onWrongChain, switchChain]);

  if (!ready) {
    return <span className="text-sm text-fg-3">{m.common.loading}</span>;
  }

  if (!authenticated) {
    return (
      <Button
        size="sm"
        onClick={() => {
          trackStep("sign_in_opened");
          login();
        }}
      >
        {m.wallet.signIn}
      </Button>
    );
  }

  if (!address) {
    return <span className="text-sm text-fg-3">{m.wallet.connecting}</span>;
  }

  if (onWrongChain) {
    return (
      <Button size="sm" variant="caution" onClick={() => switchChain({ chainId: monad.id })} disabled={isSwitching} title={switchError?.message}>
        {isSwitching ? m.wallet.switching : m.wallet.switchToMonad}
      </Button>
    );
  }

  const embeddedWallet = user?.linkedAccounts.find(
    (account) => account.type === "wallet" && account.walletClientType === "privy" && account.chainType === "ethereum",
  );

  return (
    <details className="relative">
      <summary className="flex h-11 cursor-pointer list-none items-center gap-2.5 rounded-full bg-surface-1 pr-4 pl-1.5 text-sm font-medium tabular-nums transition-colors duration-200 ease-spring hover:bg-surface-2">
        <span aria-hidden className="size-8 rounded-full bg-peri" />
        {shortAddress(address)}
      </summary>
      <div className="squircle absolute right-0 z-30 mt-2 w-72 space-y-4 rounded-panel bg-surface-2 p-5">
        <p className="break-all text-xs text-fg-2">{address}</p>
        <Balances address={address} />
        <div className="flex flex-col gap-2.5 border-t border-line pt-4 text-sm">
          {embeddedWallet?.type === "wallet" && (
            <ExportWalletButton onExport={() => exportWallet({ address: embeddedWallet.address })} />
          )}
          <button onClick={logout} className="text-left text-fg-2 transition-colors hover:text-fg">
            {m.wallet.signOut}
          </button>
        </div>
      </div>
    </details>
  );
}

function ExportWalletButton({ onExport }: { onExport: () => Promise<void> }) {
  const m = useT();
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    try {
      await onExport();
    } catch (e) {
      setError(e instanceof Error ? e.message : m.wallet.exportFailed);
    }
  }

  return (
    <div>
      <button onClick={handleClick} className="text-left text-fg-2 transition-colors hover:text-fg">
        {m.wallet.exportKey}
      </button>
      {error && <p className="mt-1 text-xs text-down">{error}</p>}
    </div>
  );
}
