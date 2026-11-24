import { tokensByChain } from "@levra/shared/addresses";
import type { Address } from "viem";

/**
 * Circle CCTP V2 on EVM chains (BE-85, D-54). Facts from Circle's docs on 24 November 2026 ("Supported blockchains and
 * domains", "Contract addresses", "USDC contract addresses"). On X Layer the contracts were also read onchain: the
 * transmitter's `localDomain()` is 37 and the messenger's `localMinter()` is the TokenMinterV2 below.
 */
export const TOKEN_MESSENGER_V2: Address = "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d";
export const MESSAGE_TRANSMITTER_V2: Address = "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64";
export const TOKEN_MINTER_V2: Address = "0xfd78EE919681417d192449715b2594ab58f5D002";

/** Finality the burn waits for: 1000 is a Fast Transfer (a fee, seconds), 2000 a Standard Transfer (no fee). */
export const FAST_FINALITY = 1000;
export const STANDARD_FINALITY = 2000;

export type CctpChain = {
  chainId: number;
  domain: number;
  name: string;
  /** Native USDC, 6 decimals. */
  usdc: Address;
  /** Fast Transfer as a source. Where Circle lists it as not needed, a Standard Transfer is already fast. */
  fastSource: boolean;
};

/**
 * EVM chains a deposit can come from or a withdrawal go to. Every one is a Forwarding Service destination, so Circle
 * mints on arrival and nobody has to hold gas there. Left out: chains with other contract addresses (EDGE), USYC only
 * (BNB Smart Chain), and chains no wallet we support lists yet.
 */
export const cctpChains: readonly CctpChain[] = [
  { chainId: 1, domain: 0, name: "Ethereum", usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", fastSource: true },
  { chainId: 43114, domain: 1, name: "Avalanche", usdc: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", fastSource: false },
  { chainId: 10, domain: 2, name: "OP Mainnet", usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", fastSource: true },
  { chainId: 42161, domain: 3, name: "Arbitrum", usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", fastSource: true },
  { chainId: 8453, domain: 6, name: "Base", usdc: tokensByChain[8453].USDC.address, fastSource: true },
  { chainId: 137, domain: 7, name: "Polygon PoS", usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", fastSource: false },
  { chainId: 130, domain: 10, name: "Unichain", usdc: "0x078D782b760474a361dDA0AF3839290b0EF57AD6", fastSource: true },
  { chainId: 59144, domain: 11, name: "Linea", usdc: "0x176211869cA2b568f2A7D4EE941E073a821EE1ff", fastSource: true },
  { chainId: 146, domain: 13, name: "Sonic", usdc: "0x29219dd400f2Bf60E5a23d13Be72B486D4038894", fastSource: false },
  { chainId: 480, domain: 14, name: "World Chain", usdc: "0x79A02482A880bCe3F13E09da970dC34dB4cD24D1", fastSource: true },
  { chainId: 143, domain: 15, name: "Monad", usdc: tokensByChain[143].USDC.address, fastSource: false },
  { chainId: 1329, domain: 16, name: "Sei", usdc: "0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392", fastSource: false },
  { chainId: 999, domain: 19, name: "HyperEVM", usdc: "0xb88339CB7199b77E23DB6E890353E22632Ba630f", fastSource: false },
  { chainId: 57073, domain: 21, name: "Ink", usdc: "0x2D270e6886d130D724215A266106e6832161EAEd", fastSource: true },
  { chainId: 196, domain: 37, name: "X Layer", usdc: tokensByChain[196].USDC.address, fastSource: true },
];

export const cctpChain = (chainId: number) => cctpChains.find((c) => c.chainId === chainId);
export const cctpChainByDomain = (domain: number) => cctpChains.find((c) => c.domain === domain);
