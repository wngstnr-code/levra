import { describe, expect, it } from "vitest";
import { en } from "./i18n/en";
import { haltNotice, hasNoPrice, manageTabs } from "./marketState";

describe("hasNoPrice", () => {
  it("is true only for a zero price", () => {
    expect(hasNoPrice("0")).toBe(true);
    expect(hasNoPrice(0n)).toBe(true);
    expect(hasNoPrice("51234000000")).toBe(false);
    expect(hasNoPrice(null)).toBe(false);
    expect(hasNoPrice(undefined)).toBe(false);
  });
});

describe("haltNotice", () => {
  it("is null for an open market or no market", () => {
    expect(haltNotice({ haltReasons: [], tokenPaused: false }, en)).toBeNull();
    expect(haltNotice({}, en)).toBeNull();
    expect(haltNotice(null, en)).toBeNull();
  });

  it("blocks with the issuer's sentences", () => {
    const n = haltNotice({ haltReasons: ["Circle paused USDC on Base."] }, en);
    expect(n).toMatchObject({ blocks: true, title: en.halt.title, body: "Circle paused USDC on Base." });
  });

  it("blocks on a paused token without reasons", () => {
    expect(haltNotice({ tokenPaused: true }, en)?.body).toBe(en.halt.tokenPaused);
  });
});

describe("manageTabs", () => {
  const all = ["add", "remove", "repay", "reduce", "close"] as const;
  it("keeps every tab with a price", () => {
    expect(manageTabs(all, false, "reduce")).toEqual({ tabs: [...all], tab: "reduce" });
  });
  it("offers only add, repay and close without a price, and falls back to close", () => {
    expect(manageTabs(all, true, "reduce")).toEqual({ tabs: ["add", "repay", "close"], tab: "close" });
    expect(manageTabs(all, true, "add").tab).toBe("add");
  });
});
