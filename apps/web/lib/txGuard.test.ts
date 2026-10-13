import { marginRouterAbi } from "@levra/shared/abis";
import { describe, expect, it } from "vitest";
import { encodeFunctionData, zeroAddress, type Hex } from "viem";
import { guardRouterTx, TxGuardError } from "./txGuard";

const router = "0xa3F19ac30Be34028D9a0CaAcaF00c0b7295Fc2E6" as const;
const marketId = `0x${"11".repeat(32)}` as Hex;
const other = `0x${"22".repeat(32)}` as Hex;

const open = (id: Hex) =>
  encodeFunctionData({
    abi: marginRouterAbi,
    functionName: "openLong",
    args: [{ marketId: id, margin: 100_000_000n, borrowAssets: 100_000_000n, swap: { target: zeroAddress, data: "0x", minOut: 1n }, maxLtv: 10n ** 17n, deadline: 2_000_000_000n }],
  });
const setProtection = encodeFunctionData({ abi: marginRouterAbi, functionName: "setProtection", args: [marketId, true] });
const authorize = encodeFunctionData({
  abi: marginRouterAbi,
  functionName: "authorizeWithSig",
  args: [zeroAddress, true, 0n, 2_000_000_000n, 27, `0x${"aa".repeat(32)}`, `0x${"bb".repeat(32)}`],
});
const tx = (to: Hex, data: Hex) => ({ to, data, value: "0", gasLimit: "0" });

describe("guardRouterTx", () => {
  it("accepts the expected action on the shown market", () => {
    expect(guardRouterTx(tx(router, open(marketId)), { router, action: "openLong", marketId }).map((c) => c.name)).toEqual(["openLong"]);
  });

  it("accepts setup calls inside a multicall", () => {
    const data = encodeFunctionData({ abi: marginRouterAbi, functionName: "multicall", args: [[authorize, open(marketId)]] });
    expect(guardRouterTx(tx(router, data), { router, action: "openLong", marketId }).map((c) => c.name)).toEqual(["authorizeWithSig", "openLong"]);
  });

  it("refuses another target", () => {
    expect(() => guardRouterTx(tx("0x0000000000000000000000000000000000000001", open(marketId)), { router, action: "openLong" })).toThrow(TxGuardError);
  });

  it("refuses a different action", () => {
    expect(() => guardRouterTx(tx(router, setProtection), { router, action: "openLong" })).toThrow(/does not match/);
  });

  it("refuses a different market", () => {
    expect(() => guardRouterTx(tx(router, open(other)), { router, action: "openLong", marketId })).toThrow(/different market/);
  });

  it("refuses data it cannot read", () => {
    expect(() => guardRouterTx(tx(router, "0xdeadbeef"), { router, action: "openLong" })).toThrow(/could not be read/);
  });
});
