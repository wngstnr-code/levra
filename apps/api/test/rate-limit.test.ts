import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { SwapError, type SwapSource } from "@levra/kyber";
import { apiError } from "@levra/shared/api";
import { Hono } from "hono";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { parsePatterns } from "../src/origins";
import { createBucketStore } from "../src/rate-limit/bucket";
import { rateLimit, type RateLimitRules } from "../src/rate-limit/middleware";
import { budgetedSwap } from "../src/rate-limit/swap-budget";

const WALLET = "0x1111111111111111111111111111111111111111";
const OTHER_WALLET = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x3333333333333333333333333333333333333333";

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("bucket store", () => {
  it("allows a burst up to the capacity, then refills over time", () => {
    const c = clock();
    const store = createBucketStore({ capacity: 3, perMinute: 60 }, c.now);
    expect([store.take("a"), store.take("a"), store.take("a")].every((r) => r.ok)).toBe(true);
    expect(store.take("a")).toEqual({ ok: false, retryAfterMs: 1000 });
    expect(store.take("b").ok).toBe(true);
    c.advance(1000);
    expect(store.take("a").ok).toBe(true);
    expect(store.take("a").ok).toBe(false);
  });

  it("charges a cost above one and refuses a cost the bucket cannot hold yet", () => {
    const c = clock();
    const store = createBucketStore({ capacity: 3, perMinute: 60 }, c.now);
    expect(store.take("a", 2).ok).toBe(true);
    expect(store.take("a", 2)).toEqual({ ok: false, retryAfterMs: 1000 });
  });

  it("drops full buckets when the key limit is reached", () => {
    const c = clock();
    const store = createBucketStore({ capacity: 1, perMinute: 60 }, c.now, 2);
    store.take("a");
    store.take("b");
    c.advance(1000);
    store.take("c");
    expect(store.size()).toBe(1);
  });
});

const rules: RateLimitRules = {
  ip: { capacity: 5, perMinute: 5 },
  quoteIp: { capacity: 3, perMinute: 3 },
  quoteWallet: { capacity: 2, perMinute: 2 },
  accountWallet: { capacity: 2, perMinute: 2 },
};

function testApp(now: () => number) {
  const app = new Hono();
  app.use(rateLimit({ rules, trustProxyHeader: "x-forwarded-for", now }));
  app.get("/v1/health", (c) => c.json({ ok: true }));
  app.get("/v1/markets", (c) => c.json({ ok: true }));
  app.get("/v1/accounts/:address", (c) => c.json({ address: c.req.param("address") }));
  app.get("/v1/earn/:address", (c) => c.json({ address: c.req.param("address") }));
  app.post("/v1/quote/open", async (c) => c.json({ user: ((await c.req.json()) as { user: string }).user }));
  app.post("/v1/deposit/quote", async (c) => c.json({ ok: true }));
  return app;
}

function get(app: Hono, path: string, ip: string) {
  return app.request(path, { headers: { "x-forwarded-for": ip } });
}

function quote(app: Hono, ip: string, user: string) {
  return app.request("/v1/quote/open", {
    method: "POST",
    headers: { "x-forwarded-for": ip, "content-type": "application/json" },
    body: JSON.stringify({ user }),
  });
}

describe("rate limit middleware", () => {
  it("limits one IP address and answers RATE_LIMITED with Retry-After", async () => {
    const app = testApp(clock().now);
    for (let i = 0; i < 5; i++) expect((await get(app, "/v1/markets", "10.0.0.1")).status).toBe(200);
    const limited = await get(app, "/v1/markets", "10.0.0.1");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("12");
    expect(apiError.parse(await limited.json()).error.code).toBe("RATE_LIMITED");
    expect((await get(app, "/v1/markets", "10.0.0.2")).status).toBe(200);
  });

  it("never limits the health check", async () => {
    const app = testApp(clock().now);
    for (let i = 0; i < 10; i++) expect((await get(app, "/v1/health", "10.0.0.1")).status).toBe(200);
  });

  it("trusts only the last entry of the proxy header", async () => {
    const app = testApp(clock().now);
    for (let i = 0; i < 5; i++) await get(app, "/v1/markets", `spoofed-${i}, 10.0.0.1`);
    expect((await get(app, "/v1/markets", "spoofed-9, 10.0.0.1")).status).toBe(429);
  });

  it("limits quotes for one wallet across IP addresses", async () => {
    const app = testApp(clock().now);
    expect((await quote(app, "10.0.0.1", WALLET)).status).toBe(200);
    expect((await quote(app, "10.0.0.2", WALLET.toUpperCase().replace("0X", "0x"))).status).toBe(200);
    expect((await quote(app, "10.0.0.3", WALLET)).status).toBe(429);
    expect((await quote(app, "10.0.0.3", OTHER_WALLET)).status).toBe(200);
  });

  it("limits quotes per IP address, whatever the wallet", async () => {
    const app = testApp(clock().now);
    const wallets = ["0x4", "0x5", "0x6", "0x7"].map((p) => p.padEnd(42, "0"));
    const statuses = [];
    for (const w of wallets) statuses.push((await quote(app, "10.0.0.1", w)).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it("leaves the body readable for the route", async () => {
    const app = testApp(clock().now);
    const res = await quote(app, "10.0.0.1", WALLET);
    expect(await res.json()).toEqual({ user: WALLET });
  });

  it("limits account reads per wallet and recovers after the refill", async () => {
    const c = clock();
    const app = testApp(c.now);
    expect((await get(app, `/v1/accounts/${WALLET}`, "10.0.0.1")).status).toBe(200);
    expect((await get(app, `/v1/accounts/${WALLET}`, "10.0.0.2")).status).toBe(200);
    expect((await get(app, `/v1/accounts/${WALLET}`, "10.0.0.3")).status).toBe(429);
    c.advance(30_000);
    expect((await get(app, `/v1/accounts/${WALLET}`, "10.0.0.3")).status).toBe(200);
  });
});

describe("rate limit for cross-chain quotes", () => {
  it("counts deposit quotes as quotes, per wallet through the recipient", async () => {
    const app = testApp(clock().now);
    const deposit = (ip: string) =>
      app.request("/v1/deposit/quote", { method: "POST", headers: { "x-forwarded-for": ip, "content-type": "application/json" }, body: JSON.stringify({ recipient: WALLET }) });
    expect((await deposit("10.0.0.1")).status).toBe(200);
    expect((await deposit("10.0.0.2")).status).toBe(200);
    expect((await deposit("10.0.0.3")).status).toBe(429);
  });
});

describe("rate limit inside the app", () => {
  it("answers 429 with the CORS headers, so the browser can read it", async () => {
    const app = createApp({
      logger: pino({ level: "silent" }),
      corsOrigins: parsePatterns("https://levra-mon.vercel.app"),
      rateLimit: { rules: { ...rules, ip: { capacity: 1, perMinute: 1 } }, trustProxyHeader: "x-forwarded-for" },
    });
    const call = () => app.request("/v1/config", { headers: { origin: "https://levra-mon.vercel.app", "x-forwarded-for": "10.0.0.9" } });
    await call();
    const limited = await call();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("access-control-allow-origin")).toBe("https://levra-mon.vercel.app");
  });
});

describe("rate limit for Earn reads", () => {
  it("shares the per-wallet bucket between account and Earn reads", async () => {
    const app = testApp(clock().now);
    expect((await get(app, `/v1/accounts/${WALLET}`, "10.0.0.1")).status).toBe(200);
    expect((await get(app, `/v1/earn/${WALLET}`, "10.0.0.2")).status).toBe(200);
    expect((await get(app, `/v1/earn/${WALLET}`, "10.0.0.3")).status).toBe(429);
  });
});

describe("rate limit on a real server", () => {
  it("uses the socket address when no proxy header is trusted", async () => {
    const app = new Hono();
    app.use(rateLimit({ rules: { ...rules, ip: { capacity: 2, perMinute: 2 } } }));
    app.get("/v1/markets", (c) => c.json({ ok: true }));
    const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
    try {
      await new Promise<void>((resolve) => server.once("listening", () => resolve()));
      const { port } = server.address() as AddressInfo;
      const statuses = [];
      for (let i = 0; i < 3; i++) {
        statuses.push((await fetch(`http://127.0.0.1:${port}/v1/markets`, { headers: { "x-forwarded-for": `9.9.9.${i}` } })).status);
      }
      expect(statuses).toEqual([200, 200, 429]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe("swap budget", () => {
  function countingSwap() {
    const calls = { price: 0, quote: 0 };
    const swap: SwapSource = {
      async price() {
        calls.price++;
        return 1n;
      },
      async quote() {
        calls.quote++;
        return { amountIn: 1n, amountOut: 1n, data: "0x", target: TOKEN };
      },
    };
    return { swap, calls };
  }

  const p = { tokenIn: TOKEN, tokenOut: TOKEN, amountIn: 1n } as const;

  it("stops calls from reaching KyberSwap once the budget is spent", async () => {
    const c = clock();
    const { swap, calls } = countingSwap();
    const budgeted = budgetedSwap(swap, { capacity: 5, perMinute: 60 }, c.now);

    await budgeted.quote({ ...p, sender: TOKEN, slippageBps: 50 });
    await budgeted.quote({ ...p, sender: TOKEN, slippageBps: 50 });
    await budgeted.price(p);
    const refused = await budgeted.price(p).catch((err: unknown) => err);

    expect(refused).toBeInstanceOf(SwapError);
    expect((refused as SwapError).code).toBe("RATE_LIMITED");
    expect(calls).toEqual({ price: 1, quote: 2 });

    c.advance(1000);
    await budgeted.price(p);
    expect(calls.price).toBe(2);
  });
});
