import { describe, expect, it } from "vitest";
import { WAD, expectedSupplyShares, toAssetsDown, toSharesDown, vaultSupplyApyWad } from "./math";

const USDC = 10n ** 6n;
const pct = (n: bigint) => (n * WAD) / 100n;

describe("Morpho supply accrual", () => {
  it("keeps the shares when there is no fee or no new interest", () => {
    expect(expectedSupplyShares(1_000n * USDC, 10n ** 15n, 1_010n * USDC, 0n)).toBe(10n ** 15n);
    expect(expectedSupplyShares(1_000n * USDC, 10n ** 15n, 1_000n * USDC, pct(10n))).toBe(10n ** 15n);
  });

  it("mints the fee on new interest as shares, so lenders get the interest less the fee", () => {
    const shares = 1_000n * USDC * 1_000_000n;
    const after = expectedSupplyShares(1_000n * USDC, shares, 1_010n * USDC, pct(10n));
    // 10 USDC of interest, 1 USDC of it is the fee: the fee recipient's shares are worth 1 USDC.
    expect(after - shares).toBe(toSharesDown(1n * USDC, 1_009n * USDC, shares));
    expect(toAssetsDown(after - shares, 1_010n * USDC, after)).toBe(1n * USDC - 1n);
    // The first lender, who had every share, now has 1,009 USDC.
    expect(toAssetsDown(shares, 1_010n * USDC, after)).toBe(1_009n * USDC - 1n);
  });
});

describe("vault supply APY", () => {
  it("weights each market by the vault's assets in it, counts idle assets as earning nothing, and takes the fee", () => {
    const apy = vaultSupplyApyWad(
      [
        { assets: 600n * USDC, supplyApyWad: pct(10n) },
        { assets: 300n * USDC, supplyApyWad: pct(4n) },
      ],
      1_000n * USDC,
      pct(10n),
    );
    // (600 × 10% + 300 × 4%) / 1,000 = 7.2%, less the 10% fee = 6.48%.
    expect(apy).toBe((648n * WAD) / 10_000n);
  });

  it("is zero for an empty vault", () => {
    expect(vaultSupplyApyWad([], 0n, 0n)).toBe(0n);
  });
});
