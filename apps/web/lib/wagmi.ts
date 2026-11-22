import { createConfig as createPrivyConfig } from "@privy-io/wagmi";
import type { Chain, Transport } from "viem";
import { createConfig } from "wagmi";
import { webChains } from "./chains";

const chains = webChains.map((c) => c.viem) as [Chain, ...Chain[]];
const transports = Object.fromEntries(webChains.map((c) => [c.id, c.transport])) as Record<number, Transport>;

const params = { chains, transports } as const;

/** Used when sign-in is available. Privy supplies the wallet connectors. */
export const privyWagmiConfig = createPrivyConfig(params);

/** Used when sign-in is not configured. Chain reads still work. */
export const readOnlyWagmiConfig = createConfig(params);
