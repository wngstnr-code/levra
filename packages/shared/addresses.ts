export type Address = `0x${string}`;

export const MONAD_CHAIN_ID = 143;

export const external = {
  morpho: "0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee",
  morphoAdaptiveCurveIrm: "0x09475a3D6eA8c314c592b1a3799bDE044E2F400F",
  kyberRouter: "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5",
  mondaySwapRouter: "0xFE951b693A2FE54BE5148614B109E316B567632F",
  mondayQuoterV2: "0xB97eCD41Aef0F842E773C8F9905919cDE49880C9",
  mondayFactory: "0xC1e98D0A2a58fB8aBd10ccc30a58efff4080Aa21",
  anchoredStockOracle: "0x037848af338c38e1e0ab722be80bf4c2e612a1f7",
} as const satisfies Record<string, Address>;

export const tokens = {
  USDC: { address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", decimals: 6 },
  aQQQ: { address: "0x1446501E886c7f830DB9b494A1890cBCCC072f57", decimals: 18 },
  aHOOD: { address: "0x5a4860adDCc094FcE026384caeEcb1e634DD9af4", decimals: 18 },
  aBIL: { address: "0x4FC5B9f8933597D3ecf84d0611687E1Dc8DD576f", decimals: 18 },
} as const satisfies Record<string, { address: Address; decimals: number }>;
