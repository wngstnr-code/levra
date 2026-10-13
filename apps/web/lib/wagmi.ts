import { createConfig as createPrivyConfig } from "@privy-io/wagmi";
import { createConfig } from "wagmi";
import { monad, monadTransport } from "./chain";

const params = {
  chains: [monad],
  transports: { [monad.id]: monadTransport },
} as const;

/** Used when sign-in is available. Privy supplies the wallet connectors. */
export const privyWagmiConfig = createPrivyConfig(params);

/** Used when sign-in is not configured. Chain reads still work. */
export const readOnlyWagmiConfig = createConfig(params);
