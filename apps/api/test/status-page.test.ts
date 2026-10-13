import type { StatusResponse } from "@levra/shared/api";
import { describe, expect, it } from "vitest";
import { renderStatusPage, statusRows } from "../src/status-page";

const NOW = 1_800_000_000;

function status(): StatusResponse {
  return {
    oracle: [
      { symbol: "QQQ", publishedAt: NOW - 600, ageSeconds: 600, stale: false, ageLimitSeconds: 2_100, ageLimitLearning: true },
      { symbol: "BIL", publishedAt: NOW - 900, ageSeconds: 900, stale: false },
    ],
    keepers: [
      { name: "liquidator", lastHeartbeatAt: NOW - 20, healthy: true },
      { name: "protector", lastHeartbeatAt: null, healthy: false },
      { name: "calendar", lastHeartbeatAt: NOW - 40, healthy: true },
    ],
    indexer: { lastBlock: 1_000, chainHead: 1_010, lagBlocks: 10 },
    api: { version: "abc123" },
  };
}

describe("status page", () => {
  it("lists the oracle, the keepers that run, and the indexer, and says all is normal", () => {
    const rows = statusRows(status(), NOW);
    expect(rows.ok).toBe(true);
    expect(rows.oracle.map((r) => r.detail)).toEqual(["Price live, updated 10 min ago, limit 35 min", "Price live, updated 15 min ago"]);
    // A keeper that never ran in this deployment is left out, not shown as down.
    expect(rows.keepers.map((r) => r.name)).toEqual(["Liquidations", "Market close calendar"]);
    expect(renderStatusPage(status(), NOW)).toContain("All systems normal");
  });

  it("says something needs attention for a stale price, a late keeper or a lagging indexer", () => {
    const stale = status();
    stale.oracle[0]!.stale = true;
    expect(statusRows(stale, NOW).ok).toBe(false);
    const late = status();
    late.keepers[0]!.healthy = false;
    expect(statusRows(late, NOW).keepers[0]!.detail).toContain("Not healthy");
    const lag = status();
    lag.indexer.lagBlocks = 301;
    const html = renderStatusPage(lag, NOW);
    expect(html).toContain("Some parts need attention");
    expect(html).toContain("301 blocks behind");
  });

  it("escapes what it prints", () => {
    const s = status();
    s.api.version = "<script>alert(1)</script>";
    const html = renderStatusPage(s, NOW);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });
});