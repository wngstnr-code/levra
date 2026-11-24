import type { PreparedResponse } from "@levra/shared/api";
import { describe, expect, it } from "vitest";
import { fractionFromParam, preparedPath, sameWallet, slippageFromParam } from "./prepared";

const user = "0x00000000000000000000000000000000000000A1";
const meta = { id: "abc", chainId: 8453, user, summary: "s", createdAt: 1, expiresAt: 2 };
const marketId = `0x${"11".repeat(32)}` as const;

describe("preparedPath", () => {
  it("fills the trade screen for an open", () => {
    const p = { ...meta, kind: "open", request: { user, symbol: "AAPL", side: "short", marginRaw: "250000000", leverageE2: 150, slippageBps: 50 } } as PreparedResponse;
    expect(preparedPath(p)).toBe("/trade?agent=abc&symbol=AAPL&side=short&margin=250&leverage=150&slippage=50");
  });
  it("opens the close or reduce sheet for a close", () => {
    const full = { ...meta, kind: "close", request: { user, marketId, fractionWad: "1000000000000000000", slippageBps: 50 } } as PreparedResponse;
    expect(preparedPath(full)).toContain("action=close&fraction=100");
    const part = { ...meta, kind: "close", request: { user, marketId, fractionWad: "250000000000000000", slippageBps: 50 } } as PreparedResponse;
    expect(preparedPath(part)).toContain("action=reduce&fraction=25");
  });
  it("opens the amount tab for collateral", () => {
    const p = { ...meta, kind: "collateral", request: { user, marketId, action: "repay", amountRaw: "5000000" } } as PreparedResponse;
    expect(preparedPath(p)).toBe(`/positions?agent=abc&manage=${marketId}&action=repay&amountRaw=5000000`);
  });
});

describe("sameWallet", () => {
  it("ignores case and needs a wallet", () => {
    expect(sameWallet(user.toLowerCase(), user)).toBe(true);
    expect(sameWallet(undefined, user)).toBe(false);
    expect(sameWallet("0x00000000000000000000000000000000000000b2", user)).toBe(false);
  });
});

describe("link parameters", () => {
  it("keeps slippage to the offered choices", () => {
    expect(slippageFromParam("100")).toBe(100);
    expect(slippageFromParam("5000")).toBe(50);
    expect(slippageFromParam("-30")).toBe(50);
    expect(slippageFromParam(null)).toBe(50);
  });
  it("keeps a close fraction between 1 and 100 with two decimals", () => {
    expect(fractionFromParam("33.333")).toBe(33.33);
    expect(fractionFromParam("0.4")).toBe(1);
    expect(fractionFromParam("250")).toBe(100);
    expect(fractionFromParam("x")).toBeUndefined();
  });
  it("carries a fraction like 33.33% exactly", () => {
    const p = { ...meta, kind: "close", request: { user, marketId, fractionWad: "333300000000000000", slippageBps: 50 } } as PreparedResponse;
    expect(preparedPath(p)).toContain("action=reduce&fraction=33.33");
  });
});
