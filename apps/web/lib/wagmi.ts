import { createConfig as createPrivyConfig } from "@privy-io/wagmi";
import { http, type Chain, type Transport } from "viem";
import { createConfig } from "wagmi";
import { extraBridgeChains } from "./bridgeChains";
import { webChains } from "./chains";

const ours = webChains.map((c) => c.viem);
/** Our chains first; the other CCTP chains only so the wallet can send a bridge transfer from them. */
export const walletChains = [...ours, ...extraBridgeChains(ours)] as [Chain, ...Chain[]];
const chains = walletChains;
const transports = Object.fromEntries([...webChains.map((c) => [c.id, c.transport]), ...extraBridgeChains(ours).map((c) => [c.id, http()])]) as Record<number, Transport>;

const params = { chains, transports } as const;

/** Used when sign-in is available. Privy supplies the wallet connectors. */
export const privyWagmiConfig = createPrivyConfig(params);

/** Used when sign-in is not configured. Chain reads still work. */
export const readOnlyWagmiConfig = createConfig(params);
