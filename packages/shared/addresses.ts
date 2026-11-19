import type { ChainId } from "./chains";

export type Address = `0x${string}`;
export type TokenInfo = { address: Address; decimals: number };

export const MONAD_CHAIN_ID = 143 satisfies ChainId;
export const BASE_CHAIN_ID = 8453 satisfies ChainId;

/** Contracts every chain has. Chain specific contracts sit next to them. */
type CommonExternal = {
  morpho: Address;
  morphoAdaptiveCurveIrm: Address;
  morphoVaultFactory: Address;
  morphoVaultV2Factory: Address;
  /** The BluePublicAllocator, for Vault V2 vaults. It does not serve MetaMorpho vaults. */
  morphoPublicAllocator: Address;
  permit2: Address;
  multicall3: Address;
  safeSingleton: Address;
  safeSingletonL2: Address;
  safeProxyFactory: Address;
};

/** Contracts we use but did not deploy on Monad. Each was confirmed to have code on Monad mainnet. */
export const external = {
  morpho: "0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee",
  morphoAdaptiveCurveIrm: "0x09475a3D6eA8c314c592b1a3799bDE044E2F400F",
  morphoVaultFactory: "0x33f20973275B2F574488b18929cd7DCBf1AbF275",
  morphoVaultV2Factory: "0x8B2F922162FBb60A6a072cC784A2E4168fB0bb0c",
  morphoMarketAdapterV2Factory: "0xa00666E86C7e2FA8d2c78d9481E687e098340180",
  morphoPublicAllocator: "0x0A503aB026EFACBC0F7feE7795F34B80b5B9a662",
  kyberRouter: "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5",
  mondaySwapRouter: "0xFE951b693A2FE54BE5148614B109E316B567632F",
  mondayQuoterV2: "0xB97eCD41Aef0F842E773C8F9905919cDE49880C9",
  mondayFactory: "0xC1e98D0A2a58fB8aBd10ccc30a58efff4080Aa21",
  anchoredStockOracle: "0x037848af338C38e1e0AB722bE80BF4C2E612a1F7",
  anchoredCompliance: "0xF1aeD4E4816a91CebfCBd33378E38962abf73276",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
  safeSingleton: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
  safeSingletonL2: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
  safeProxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
  wrappedMon: "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A",
} as const satisfies CommonExternal & Record<string, Address>;

/** Monad tokens. */
export const tokens = {
  USDC: { address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", decimals: 6 },
  aQQQ: { address: "0x1446501E886c7f830DB9b494A1890cBCCC072f57", decimals: 18 },
  aHOOD: { address: "0x5a4860adDCc094FcE026384caeEcb1e634DD9af4", decimals: 18 },
  aBIL: { address: "0x4FC5B9f8933597D3ecf84d0611687E1Dc8DD576f", decimals: 18 },
} as const satisfies Record<string, TokenInfo>;

/** Contracts we use but did not deploy on Base. Each was confirmed to have code on Base mainnet (05, Base). */
export const baseExternal = {
  morpho: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
  morphoAdaptiveCurveIrm: "0x46415998764C29aB2a25CbeA6254146D50D22687",
  morphoVaultFactory: "0xFf62A7c278C62eD665133147129245053Bbf5918",
  morphoVaultV2Factory: "0x4501125508079A99ebBebCE205DeC9593C2b5857",
  morphoPublicAllocator: "0xAED282B8aD9257BB1272e93aE63A32A53621e412",
  morphoMetaMorphoPublicAllocator: "0xA090dD1a701408Df1d4d0B85b716c87565f90467",
  morphoChainlinkOracleV2Factory: "0x2DC205F24BCb6B311E5cdf0745B0741648Aebd3d",
  coinbaseOracleRegistry: "0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD",
  b20PolicyRegistry: "0x8453000000000000000000000000000000000002",
  b20TokenFactory: "0x4bA3E29E254F25E94E61C4c9d67b37027331534D",
  oneInchRouter: "0x111111125421cA6dc452d289314280a0f8842A65",
  aerodromeRouter: "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",
  aerodromeSlipstreamRouter: "0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
  safeSingleton: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
  safeSingletonL2: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
  safeProxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
} as const satisfies CommonExternal & Record<string, Address>;

/** Base tokens. Coinbase stock tokens are B20 precompiles with 8 decimals. */
export const baseTokens = {
  USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
  AAPLc: { address: "0xb200000000000000000000C2e324d24d7eEcd1fb", decimals: 8 },
  AMZNc: { address: "0xb200000000000000000000d9192b6B456483C2E8", decimals: 8 },
  GOOGLc: { address: "0xb2000000000000000000002D0BA3164cc74f58B7", decimals: 8 },
  METAc: { address: "0xb2000000000000000000008bC8786B856E61707C", decimals: 8 },
  MSFTc: { address: "0xB200000000000000000000Ab99cFa739E253872B", decimals: 8 },
  NVDAc: { address: "0xb20000000000000000000078ee7ce2fE4908108C", decimals: 8 },
  SPCXc: { address: "0xb2000000000000000000007b9fcbd005511aCBd5", decimals: 8 },
  TSLAc: { address: "0xb2000000000000000000001e800a7f5189430cD0", decimals: 8 },
} as const satisfies Record<string, TokenInfo>;

export const externalByChain = { 143: external, 8453: baseExternal } as const satisfies Record<ChainId, CommonExternal>;

export const tokensByChain = { 143: tokens, 8453: baseTokens } as const satisfies Record<ChainId, { USDC: TokenInfo }>;
