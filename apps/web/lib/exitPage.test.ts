import { describe, expect, it } from "vitest";
import { webChains } from "./chains";
import { exitPageHtml } from "./exitPage";

describe("exit page", () => {
  const html = exitPageHtml();
  it("lists every chain, router, previous router and market", () => {
    for (const c of webChains) {
      expect(html).toContain(`<h2>${c.name}</h2>`);
      expect(html).toContain(c.deployment.router);
      for (const r of c.deployment.previousRouters ?? []) expect(html).toContain(r);
      for (const mk of c.deployment.markets) expect(html).toContain(mk.marketId);
    }
  });
  it("has no script and no request to our servers", () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/levra\.finance/);
    expect(html).toContain("repay(marketParams, 0, borrowShares, yourAddress, 0x)");
  });
});
