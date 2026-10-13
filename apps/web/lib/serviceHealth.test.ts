import type { StatusResponse } from "@levra/shared/api";
import { describe, expect, it } from "vitest";
import { serviceHealth } from "./serviceHealth";

const healthy: StatusResponse = {
  oracle: [{ symbol: "QQQ", publishedAt: 1, ageSeconds: 60, stale: false }],
  keepers: [{ name: "oracleMonitor", lastHeartbeatAt: 1, healthy: true }],
  indexer: { lastBlock: 100, chainHead: 102, lagBlocks: 2 },
  api: { version: "test" },
};

describe("serviceHealth", () => {
  it("is quiet when everything is fine", () => {
    expect(serviceHealth(healthy)).toEqual({ staleSymbols: [], degraded: false });
  });

  it("names stale prices and flags a lagging indexer or an unhealthy keeper", () => {
    expect(serviceHealth({ ...healthy, oracle: [{ ...healthy.oracle[0]!, stale: true }] }).staleSymbols).toEqual(["QQQ"]);
    expect(serviceHealth({ ...healthy, indexer: { lastBlock: 1, chainHead: 500, lagBlocks: 499 } }).degraded).toBe(true);
    expect(serviceHealth({ ...healthy, keepers: [{ name: "liquidator", lastHeartbeatAt: null, healthy: false }] }).degraded).toBe(true);
  });

  it("does not warn users when only the team monitor is down", () => {
    expect(serviceHealth({ ...healthy, keepers: [{ name: "monitor", lastHeartbeatAt: null, healthy: false }] }).degraded).toBe(false);
  });
});
