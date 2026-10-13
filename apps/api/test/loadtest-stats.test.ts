import { describe, expect, it } from "vitest";
import { OutboundCounter, percentile, RouteRecorder } from "../loadtest/stats";

describe("load test stats", () => {
  it("takes nearest-rank percentiles", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 95)).toBe(95);
    expect(percentile(values, 99)).toBe(99);
    expect(percentile([7], 99)).toBe(7);
    expect(percentile([], 50)).toBe(0);
  });

  it("counts every JSON-RPC call inside a batch", async () => {
    const counter = new OutboundCounter();
    const fetchFn = counter.wrap(async () => new Response("{}"));
    await fetchFn("http://rpc", {
      method: "POST",
      body: JSON.stringify([
        { jsonrpc: "2.0", id: 1, method: "eth_call" },
        { jsonrpc: "2.0", id: 2, method: "eth_call" },
        { jsonrpc: "2.0", id: 3, method: "eth_blockNumber" },
      ]),
    });
    await fetchFn("http://kyber/route/build", { method: "POST", body: JSON.stringify({ routeSummary: {} }) });
    expect(counter.requests).toBe(2);
    expect(counter.methods.toObject()).toEqual({ eth_call: 2, eth_blockNumber: 1 });
  });

  it("groups statuses and latencies per route", () => {
    const recorder = new RouteRecorder();
    recorder.record("GET /v1/markets", 200, 10);
    recorder.record("GET /v1/markets", 429, 2);
    recorder.record("GET /v1/markets", 200, 30);
    expect(recorder.summary()["GET /v1/markets"]).toEqual({ count: 3, statuses: { "200": 2, "429": 1 }, p50Ms: 10, p95Ms: 30, p99Ms: 30 });
  });
});
