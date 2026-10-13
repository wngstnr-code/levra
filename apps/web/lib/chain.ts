import { MONAD_CHAIN_ID } from "@levra/shared/addresses";
import { http } from "viem";
import { monad as monadDefaults } from "viem/chains";

const rpcUrl = process.env.NEXT_PUBLIC_MONAD_RPC_URL || undefined;

export const monad = rpcUrl
  ? { ...monadDefaults, rpcUrls: { default: { http: [rpcUrl] } } }
  : monadDefaults;

if (monad.id !== MONAD_CHAIN_ID) throw new Error(`viem Monad chain id ${monad.id} is not ${MONAD_CHAIN_ID}`);

export const monadTransport = http(rpcUrl);
