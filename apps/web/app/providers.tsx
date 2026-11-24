"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider as PrivyWagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { WagmiProvider } from "wagmi";
import { ComplianceProvider } from "@/components/gate/Compliance";
import { PrivySignInProvider } from "@/components/SignIn";
import { StreamSync } from "@/lib/api/stream";
import { defaultChain } from "@/lib/chains";
import { privyAppId } from "@/lib/privy";
import { useTheme } from "@/lib/theme";
import { privyWagmiConfig, readOnlyWagmiConfig, walletChains } from "@/lib/wagmi";

export function Providers({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } }));

  const inner = (
    <>
      <StreamSync />
      <ComplianceProvider>{children}</ComplianceProvider>
    </>
  );

  if (!privyAppId) {
    return (
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={readOnlyWagmiConfig}>{inner}</WagmiProvider>
      </QueryClientProvider>
    );
  }

  return (
    <PrivyProvider
      appId={privyAppId}
      config={{
        loginMethods: ["wallet", "email", "passkey"],
        appearance: { theme, walletChainType: "ethereum-only", walletList: ["base_account", "metamask", "okx_wallet", "rainbow", "coinbase_wallet", "wallet_connect"] },
        defaultChain: defaultChain.viem,
        supportedChains: walletChains,
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <PrivyWagmiProvider config={privyWagmiConfig}>
          <PrivySignInProvider>{inner}</PrivySignInProvider>
        </PrivyWagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
