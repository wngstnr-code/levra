"use client";

import { useExportWallet, usePrivy } from "@privy-io/react-auth";
import { useState } from "react";
import { useAccount } from "wagmi";
import { monad } from "@/lib/chain";
import { shortAddress } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

/** Only mounted when Privy is configured, because it uses Privy hooks. */
export function WalletCard() {
  const m = useT();
  const { user, logout } = usePrivy();
  const { exportWallet } = useExportWallet();
  const { address } = useAccount();
  const [error, setError] = useState<string | null>(null);
  const embedded = user?.linkedAccounts.find((a) => a.type === "wallet" && a.walletClientType === "privy" && a.chainType === "ethereum");
  const method = user?.email ? m.settings.methods.email : user?.linkedAccounts.some((a) => a.type === "passkey") ? m.settings.methods.passkey : m.settings.methods.wallet;
  return (
    <Card className="flex flex-col gap-2">
      <h2 className="text-xl font-semibold">{m.settings.wallet}</h2>
      {[
        [m.settings.signedInWith, method],
        [m.settings.address, address ? shortAddress(address) : "—"],
        [m.settings.network, monad.name],
      ].map(([k, v]) => (
        <p key={k} className="flex py-1 text-sm">
          <span className="text-fg-2">{k}</span>
          <span className="ml-auto font-semibold">{v}</span>
        </p>
      ))}
      {embedded && <p className="text-[13px] text-fg-2">{m.settings.walletBody}</p>}
      {error && <p className="text-[13px] text-down">{error}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {embedded?.type === "wallet" && (
          <Button variant="secondary" size="sm" onClick={() => exportWallet({ address: embedded.address }).catch((e: unknown) => setError(e instanceof Error ? e.message : m.wallet.exportFailed))}>
            {m.wallet.exportKey}
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={logout}>
          {m.wallet.signOut}
        </Button>
      </div>
    </Card>
  );
}
