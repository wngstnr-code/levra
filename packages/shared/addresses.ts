export type Address = `0x${string}`;

export const MONAD_CHAIN_ID = 143;

/** Contracts we use but did not deploy. Each was confirmed to have code on Monad mainnet. */
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
} as const satisfies Record<string, Address>;

export const tokens = {
  USDC: { address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", decimals: 6 },
  aQQQ: { address: "0x1446501E886c7f830DB9b494A1890cBCCC072f57", decimals: 18 },
  aHOOD: { address: "0x5a4860adDCc094FcE026384caeEcb1e634DD9af4", decimals: 18 },
  aBIL: { address: "0x4FC5B9f8933597D3ecf84d0611687E1Dc8DD576f", decimals: 18 },
} as const satisfies Record<string, { address: Address; decimals: number }>;
