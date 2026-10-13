"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider as PrivyWagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { WagmiProvider } from "wagmi";
import { PrivySignInProvider } from "@/components/SignIn";
import { StreamSync } from "@/lib/api/stream";
import { monad } from "@/lib/chain";
import { I18nProvider } from "@/lib/i18n";
import { privyAppId } from "@/lib/privy";
import { privyWagmiConfig, readOnlyWagmiConfig } from "@/lib/wagmi";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } }));

  const inner = (
    <I18nProvider>
      <StreamSync />
      {children}
    </I18nProvider>
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
        appearance: { theme: "dark", walletChainType: "ethereum-only" },
        defaultChain: monad,
        supportedChains: [monad],
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
