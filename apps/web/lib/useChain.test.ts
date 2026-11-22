import { describe, expect, it } from "vitest";
import { chainFromPath, switchChainPath } from "./useChain";

describe("chain in the URL", () => {
  it("reads the chain from the first path part", () => {
    expect(chainFromPath("/monad/trade").slug).toBe("monad");
  });

  it("falls back to the default chain", () => {
    expect(chainFromPath("/").slug).toBe("monad");
    expect(chainFromPath("/nowhere/markets").slug).toBe("monad");
  });

  it("keeps the page when switching chains", () => {
    expect(switchChainPath("/monad/positions", { slug: "base" })).toBe("/base/positions");
  });

  it("goes back to the market list when the stock may not exist on the other chain", () => {
    expect(switchChainPath("/monad/markets/HOOD", { slug: "base" })).toBe("/base/markets");
    expect(switchChainPath("/", { slug: "base" })).toBe("/base/markets");
  });
});
