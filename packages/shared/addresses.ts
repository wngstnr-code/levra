import type { ChainId } from "./chains";

export type Address = `0x${string}`;
export type TokenInfo = { address: Address; decimals: number };

export const MONAD_CHAIN_ID = 143 satisfies ChainId;
export const BASE_CHAIN_ID = 8453 satisfies ChainId;
export const XLAYER_CHAIN_ID = 196 satisfies ChainId;

/** Contracts every chain has. Chain specific contracts sit next to them. */
type CommonExternal = {
  morpho: Address;
  morphoAdaptiveCurveIrm: Address;
  morphoVaultV2Factory: Address;
  /** The BluePublicAllocator, for Vault V2 vaults. It does not serve MetaMorpho vaults. */
  morphoPublicAllocator: Address;
  permit2: Address;
  multicall3: Address;
  safeSingleton: Address;
  safeSingletonL2: Address;
  safeProxyFactory: Address;
  /** Circle CCTP V2, the same addresses on every EVM chain (05, Circle CCTP V2). */
  cctpTokenMessengerV2: Address;
  cctpMessageTransmitterV2: Address;
  cctpTokenMinterV2: Address;
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
  cctpTokenMessengerV2: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
  cctpMessageTransmitterV2: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
  cctpTokenMinterV2: "0xfd78EE919681417d192449715b2594ab58f5D002",
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
  /** The three swap targets on Base (D-80): two aggregators and the router of the deepest stock pools. */
  oneInchRouter: "0x111111125421cA6dc452d289314280a0f8842A65",
  kyberRouter: "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5",
  aeroSwapRouter: "0x9Ee35Bf1bd69a03c6F0393582030fCe8Bb93D418",
  aeroClFactory: "0x9CB220581b91b0C83223012FE69688b92aD07a76",
  aeroMetaQuoter: "0x1dDfeC5058180C207F55BB77D95AcDd0d8227868",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
  safeSingleton: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
  safeSingletonL2: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
  safeProxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
  cctpTokenMessengerV2: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
  cctpMessageTransmitterV2: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
  cctpTokenMinterV2: "0xfd78EE919681417d192449715b2594ab58f5D002",
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

/**
 * Contracts we use but did not deploy on X Layer. Each was confirmed to have code on X Layer mainnet (05, X Layer).
 * X Layer has no MetaMorpho (Vault V1) factory, only Vault V2.
 */
export const xlayerExternal = {
  morpho: "0xeb00C490E888286357dC5B0a35D37D9260D11Ab5",
  morphoAdaptiveCurveIrm: "0x5688FF1aBC4089cB69dC0F56727E696A49D77E24",
  morphoVaultV2Factory: "0x63D6eAc0d16D57dd131D9023ADb060277d3237d7",
  morphoMarketAdapterV2Factory: "0xDD0FC0c74bd89A9C6623202473E75CbF472b33A4",
  morphoPublicAllocator: "0x1b7C60330E3aFe5bA876F518Ff14316EA497f683",
  morphoChainlinkOracleV2Factory: "0x625Eb26d759ef8077202d4a5A63098B4B28616Db",
  xStocksSanctionsList: "0x615Dd3B9445A94334C1579F68115042D77CC7c44",
  /** Swap targets on X Layer (D-85). OKX pulls through its approve contract (D-88). */
  okxDexRouter: "0x7c5bEE2a8091C3ef39072f64F18Fac913060AEaF",
  okxDexApprove: "0x8b773D83bc66Be128c60e07E17C8901f7a64F000",
  uniswapSwapRouter02: "0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA",
  /** Uniswap QuoterV2 (Uniswap/contracts deployments/196.md), same factory as uniswapSwapRouter02. A quote source, never a swap target. */
  uniswapQuoterV2: "0xD1b797D92d87B688193A2B976eFc8D577D204343",
  /** TapeOut on X Layer (05, TapeOut transistors). Not ours: the factory is upgradeable by its owner. createCPU pulls deployFee() in BEM. */
  tapeoutFactory: "0x1f09DAeFA827f02CBb40967cc91b259763760761",
  /** Opens a circuit container, FEE() 0.08 OKB, once per circuit. */
  tapeoutOpener: "0x536adD8F30f03b69f6fbF29d425A816A0dC50106",
  tapesendHub: "0xe61A9C7213a6Aa616C246a2B569e555B417b25ee",
  /** BEM, 8 decimals. Pays the TapeOut factory fees. */
  bem: "0x60e62Efa9405d6873C5deaBD4E6CC91c25363952",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
  safeSingleton: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
  safeSingletonL2: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
  safeProxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
  wrappedOkb: "0xe538905cf8410324e03A5A23C1c177a474D59b2b",
  cctpTokenMessengerV2: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
  cctpMessageTransmitterV2: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
  cctpTokenMinterV2: "0xfd78EE919681417d192449715b2594ab58f5D002",
} as const satisfies CommonExternal & Record<string, Address>;

/** X Layer tokens. USDC is Circle's native token; the stocks are the wrapped xStocks the Morpho markets use. */
export const xlayerTokens = {
  USDC: { address: "0xB6CEceAB302E2E4948951eE7843FC24E92933061", decimals: 6 },
  wNVDAx: { address: "0xa8ddb5Cd96b5222AFe198316E9A57CAA642850D5", decimals: 18 },
  wQQQx: { address: "0x4C1AE29c159838fC1b224636E28E086EB69101f7", decimals: 18 },
  wSPYx: { address: "0xE7E553Cd128F0011777323A0b44a7b96EA1CB540", decimals: 18 },
  wGOOGLx: { address: "0xf8c5308F80E459bb53d9EbE689854d9cBb2Caa6f", decimals: 18 },
} as const satisfies Record<string, TokenInfo>;

/**
 * Levra's own TapeOut processor on X Layer (BE-82, D-113), made on 24 November 2026. Circuit IDs are local to this
 * processor. Soft layer only (D-55): no fund movement or hard limit reads these circuits.
 */
export const xlayerTapeout = {
  /** The processor's circuit NFT collection, "Levra" (LEVRA). */
  processor: "0x4D5Bf68e1362046B0281b9bA678345b7FD2aAa5c",
  transistors: "0xa2B8315F62CF21f702aFc2343E92850dc805Afbf",
  /** Holds the circuit NFTs and sends the TapeSend messages (BE-84). A key on the VPS. */
  operator: "0x5A04bBda155BF83a4675f7561aa2015b442DC5e5",
  circuits: {
    /** Market session from calendar.ts, New York dates 2026 to 2030. */
    wallStreetClock: 1,
    /** Risk at a 77% hard limit, soft limits 73% and 70% (GOOGL, QQQ, SPY). */
    risk77: 2,
    /** Risk at a 62.5% hard limit, soft limits 58% and 50% (NVDA). */
    risk62_5: 3,
  },
  /** Container of the clock circuit, opened for TapeSend and DeWEB. */
  clockContainer: "0xd2738E919bCE30a7EF36b26f51c8297352a41Ed4",
} as const satisfies { circuits: Record<string, number> } & Record<string, Address | Record<string, number>>;

export const externalByChain = { 143: external, 8453: baseExternal, 196: xlayerExternal } as const satisfies Record<
  ChainId,
  CommonExternal
>;

export const tokensByChain = { 143: tokens, 8453: baseTokens, 196: xlayerTokens } as const satisfies Record<
  ChainId,
  { USDC: TokenInfo }
>;
