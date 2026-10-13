import { writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { createDb } from "@levra/db";
import { createKyber, KYBER_MONAD_URL } from "@levra/kyber";
import { readDeployment } from "@levra/shared/deployments/node";
import pino from "pino";
import { createPublicClient, http, type Address } from "viem";
import { monad } from "viem/chains";
import { privateKeyToAddress, generatePrivateKey } from "viem/accounts";
import { createApp } from "../src/app";
import { createChainReader } from "../src/chain/reader";
import { dbEventStore } from "../src/positions/events";
import { budgetedSwap } from "../src/rate-limit/swap-budget";
import { OutboundCounter, RouteRecorder } from "./stats";

/**
 * Load test for the quote and account endpoints (BE-54). Runs the real API in this process against
 * MONAD_RPC_URL and DATABASE_URL, with the BE-51 limits on, and counts every call that leaves the
 * API: JSON-RPC calls to the chain and HTTP calls to KyberSwap. Point it at a local fork, never at
 * a shared public endpoint, unless the run is agreed with its provider.
 *
 * Each virtual user has its own IP address (through x-forwarded-for, trusted as if behind our proxy)
 * and its own wallet, and sends one request every THINK_MS.
 */

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a whole number`);
  return value;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const rpcUrl = required("MONAD_RPC_URL");
const deployment = readDeployment(required("DEPLOYMENT_FILE"));
const databaseUrl = required("DATABASE_URL");
const users = intEnv("USERS", 50);
const durationMs = intEnv("DURATION_S", 60) * 1000;
const thinkMs = intEnv("THINK_MS", 1000);
/** Shares of markets, account and quote requests, in percent. */
const mix = { markets: intEnv("MIX_MARKETS", 60), account: intEnv("MIX_ACCOUNT", 25), quote: intEnv("MIX_QUOTE", 15) };
const knownWallets = (process.env.WALLETS ?? "").split(",").map((w) => w.trim()).filter(Boolean) as Address[];
const symbols = [...new Set(deployment.markets.map((m) => m.symbol))];

const rpc = new OutboundCounter();
const kyber = new OutboundCounter();

const client = createPublicClient({
  chain: monad,
  batch: { multicall: true },
  transport: http(rpcUrl, { batch: { wait: 10 }, retryCount: 2, timeout: 15_000, fetchFn: rpc.wrap() }),
});
const { db, close } = createDb(databaseUrl);
const reader = createChainReader(client, deployment);
const swap = budgetedSwap(createKyber({ baseUrl: process.env.KYBER_BASE_URL ?? KYBER_MONAD_URL, clientId: "levra-loadtest", fetchFn: kyber.wrap() }));

const app = createApp({ logger: pino({ level: process.env.LOG_LEVEL ?? "silent" }), reader, swap, events: dbEventStore(db), db, rateLimit: { trustProxyHeader: "x-forwarded-for" } });
const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
await new Promise<void>((resolve) => server.once("listening", () => resolve()));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const routes = new RouteRecorder();
const sampleErrors = new Map<string, string>();

function pick(): keyof typeof mix {
  const total = mix.markets + mix.account + mix.quote;
  let roll = Math.random() * total;
  for (const key of ["markets", "account", "quote"] as const) {
    roll -= mix[key];
    if (roll < 0) return key;
  }
  return "markets";
}

async function send(route: string, path: string, ip: string, body?: unknown): Promise<void> {
  const started = performance.now();
  try {
    const res = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "x-forwarded-for": ip, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    routes.record(route, res.status, performance.now() - started);
    const key = `${route} ${res.status}`;
    if (res.status >= 500 && !sampleErrors.has(key)) sampleErrors.set(key, text.slice(0, 300));
  } catch {
    routes.record(route, "error", performance.now() - started);
  }
}

async function virtualUser(index: number, until: number): Promise<void> {
  const ip = `10.${Math.floor(index / 250)}.${index % 250}.1`;
  const wallet = knownWallets[index] ?? privateKeyToAddress(generatePrivateKey());
  await new Promise((resolve) => setTimeout(resolve, Math.random() * thinkMs));
  while (Date.now() < until) {
    const kind = pick();
    if (kind === "markets") await send("GET /v1/markets", "/v1/markets", ip);
    else if (kind === "account") await send("GET /v1/accounts/:address", `/v1/accounts/${wallet}`, ip);
    else {
      const symbol = symbols[Math.floor(Math.random() * symbols.length)] ?? "QQQ";
      await send("POST /v1/quote/open", "/v1/quote/open", ip, {
        user: wallet,
        symbol,
        side: "long",
        marginRaw: "10000000",
        leverageE2: 200,
        slippageBps: 100,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, thinkMs));
  }
}

/** One request per endpoint before the clock starts, so a cold fork or cache does not count. Not rate limited: its own IP. */
await send("warmup", "/v1/markets", "192.0.2.1");
await send("warmup", `/v1/accounts/${knownWallets[0] ?? privateKeyToAddress(generatePrivateKey())}`, "192.0.2.1");
const warmupRpc = rpc.methods.total();
const warmupHttp = rpc.requests;
const warmupKyber = kyber.requests;
routes.clear();

const started = Date.now();
await Promise.all(Array.from({ length: users }, (_, i) => virtualUser(i, started + durationMs)));
const seconds = (Date.now() - started) / 1000;

const summary = routes.summary();
const requests = Object.values(summary).reduce((sum, r) => sum + r.count, 0);
const rpcCalls = rpc.methods.total() - warmupRpc;
const rpcHttp = rpc.requests - warmupHttp;
const kyberHttp = kyber.requests - warmupKyber;
const report = {
  date: new Date().toISOString(),
  setup: { rpcUrl: new URL(rpcUrl).host, users, durationS: Math.round(seconds), thinkMs, mix, wallets: knownWallets.length || "random" },
  requests: { total: requests, perSecond: +(requests / seconds).toFixed(1) },
  routes: summary,
  rpc: {
    httpRequests: rpcHttp,
    httpPerSecond: +(rpcHttp / seconds).toFixed(2),
    jsonRpcCalls: rpcCalls,
    jsonRpcPerSecond: +(rpcCalls / seconds).toFixed(2),
    jsonRpcPerApiRequest: requests ? +(rpcCalls / requests).toFixed(3) : 0,
    methodsIncludingWarmup: rpc.methods.toObject(),
  },
  kyber: { httpRequests: kyberHttp, perMinute: +((kyberHttp / seconds) * 60).toFixed(1) },
  sampleErrors: Object.fromEntries(sampleErrors),
};

console.log(JSON.stringify(report, null, 2));
if (process.env.OUT) await writeFile(process.env.OUT, `${JSON.stringify(report, null, 2)}\n`);

await new Promise((resolve) => server.close(resolve));
await close();
