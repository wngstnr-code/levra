import { describe, expect, it } from "vitest";
import { chainPath, defaultChain, deployedMarketOn, listedStocks, stockOn, webChainById, webChainBySlug, webChains } from "./chains";

describe("web chains", () => {
  it("offers only chains with a deployment, Monad first", () => {
    expect(webChains.length).toBeGreaterThan(0);
    expect(webChains[0]!.slug).toBe("monad");
    for (const c of webChains) expect(c.deployment.chainId).toBe(c.id);
  });

  it("defaults to the shared default chain", () => {
    expect(defaultChain.id).toBe(143);
  });

  it("finds chains by slug and id, and nothing for unknown ones", () => {
    expect(webChainBySlug("monad")?.id).toBe(143);
    expect(webChainBySlug("nowhere")).toBeUndefined();
    expect(webChainById(1)).toBeUndefined();
  });

  it("reads stocks and markets from the chain's own lists", () => {
    const monad = webChainBySlug("monad")!;
    expect(stockOn(monad, "QQQ")?.tokenSymbol).toBe("aQQQ");
    expect(stockOn(monad, "NVDA")).toBeNull();
    expect(deployedMarketOn(monad, "QQQ", "long")).not.toBeNull();
    expect(listedStocks(monad).map((s) => s.symbol)).toEqual(["QQQ", "HOOD", "BIL"]);
  });

  it("puts the chain slug in front of a path", () => {
    expect(chainPath({ slug: "base" }, "/markets")).toBe("/base/markets");
    expect(chainPath({ slug: "monad" }, "trade?symbol=QQQ")).toBe("/monad/trade?symbol=QQQ");
  });
});
