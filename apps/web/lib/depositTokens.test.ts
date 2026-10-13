import type { DepositToken } from "@levra/shared/api";
import { describe, expect, it } from "vitest";
import { orderDepositTokens } from "./depositTokens";

const tok = (chainName: string, symbol: string): DepositToken => ({ chain: chainName.toLowerCase(), chainName, token: `${chainName}:${symbol}`, symbol, decimals: 6, minAmountRaw: null });

describe("orderDepositTokens", () => {
  it("puts common chains first and USDC first on each chain", () => {
    const list = [tok("NEAR", "wNEAR"), tok("Zcash", "ZEC"), tok("Base", "KAITO"), tok("Base", "USDC"), tok("Ethereum", "USDT"), tok("Ethereum", "USDC"), tok("Arbitrum", "ETH")];
    expect(orderDepositTokens(list).map((t) => t.token)).toEqual(["Ethereum:USDC", "Ethereum:USDT", "Base:USDC", "Base:KAITO", "Arbitrum:ETH", "NEAR:wNEAR", "Zcash:ZEC"]);
  });
});
