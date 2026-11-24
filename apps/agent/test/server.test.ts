import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLevraApi } from "../src/api";
import { createHttpHandler } from "../src/handler";
import { createLevraServer } from "../src/server";

const user = "0x00000000000000000000000000000000000a6e77";
const marketId = `0x${"11".repeat(32)}`;

type Seen = { url: string; method: string; body: unknown; ip?: string | null };
function fakeFetch(answer: (url: URL) => Response) {
  const seen: Seen[] = [];
  const fetchFn = (async (input: URL, init?: RequestInit) => {
    const ip = new Headers(init?.headers).get("x-forwarded-for");
    seen.push({ url: input.toString(), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined, ip });
    return answer(input);
  }) as typeof fetch;
  return { fetchFn, seen };
}
function fakeApi(answer: (url: URL) => Response) {
  const { fetchFn, seen } = fakeFetch(answer);
  return { api: createLevraApi("https://api.levra.test", { fetchFn }), seen };
}

async function connect(answer: (url: URL) => Response) {
  const { api, seen } = fakeApi(answer);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createLevraServer(api).connect(serverSide);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientSide);
  return { client, seen };
}

const text = (r: unknown) => (r as { content: { text: string }[] }).content[0]!.text;

describe("Levra MCP server (BE-77)", () => {
  it("lists read tools as read only and prepare tools as not", async () => {
    const { client } = await connect(() => Response.json({}));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "levra_account",
      "levra_chains",
      "levra_market",
      "levra_markets",
      "levra_prepare_close",
      "levra_prepare_collateral",
      "levra_prepare_open",
      "levra_quote_close",
      "levra_quote_collateral",
      "levra_quote_open",
      "levra_session",
    ]);
    for (const t of tools) expect(t.annotations?.readOnlyHint).toBe(!t.name.startsWith("levra_prepare_"));
    expect(client.getInstructions()).toMatch(/never holds keys/);
  });

  it("reads through the chain's routes", async () => {
    const { client, seen } = await connect(() => Response.json({ positions: [] }));
    const r = await client.callTool({ name: "levra_account", arguments: { chainId: 196, address: user } });
    expect(JSON.parse(text(r))).toEqual({ positions: [] });
    expect(seen.at(-1)).toMatchObject({ url: `https://api.levra.test/v1/196/accounts/${user}`, method: "GET" });
    await client.callTool({ name: "levra_market", arguments: { chainId: 143, symbol: "BRK.B" } });
    expect(seen.at(-1)?.url).toBe("https://api.levra.test/v1/143/markets/BRK.B");
  });

  it("quotes and prepares without the chain ID in the body", async () => {
    const { client, seen } = await connect(() => Response.json({ id: "x", url: "https://app.levra.test/prepared/x", expiresAt: 1, summary: "Close 50%." }));
    const args = { chainId: 8453, user, marketId, fractionWad: "500000000000000000", slippageBps: 50 };
    await client.callTool({ name: "levra_quote_close", arguments: args });
    expect(seen.at(-1)).toMatchObject({ url: "https://api.levra.test/v1/8453/quote/close", method: "POST", body: { user, marketId, fractionWad: "500000000000000000", slippageBps: 50 } });
    expect(seen.at(-1)?.body).not.toHaveProperty("chainId");
    const r = await client.callTool({ name: "levra_prepare_close", arguments: args });
    expect(seen.at(-1)).toMatchObject({ url: "https://api.levra.test/v1/8453/agent/prepare", body: { kind: "close", request: { user, marketId } } });
    expect(JSON.parse(text(r)).url).toBe("https://app.levra.test/prepared/x");
  });

  it("never hands out a transaction or a signature request", async () => {
    const quote = { quoteId: "q", expiresAt: 1, preview: { returnedRaw: "1" }, requirements: [{ kind: "permit" }], tx: { to: "0x1", data: "0xdead" }, warnings: [] };
    const { client } = await connect(() => Response.json(quote));
    const r = await client.callTool({ name: "levra_quote_close", arguments: { chainId: 196, user, marketId, fractionWad: "1000000000000000000", slippageBps: 50 } });
    expect(JSON.parse(text(r))).toEqual({ quoteId: "q", expiresAt: 1, preview: { returnedRaw: "1" }, warnings: [] });
  });

  it("returns the API's refusal as a tool error", async () => {
    const { client } = await connect(() => Response.json({ error: { code: "NO_ROUTE", message: "No swap route for this size." } }, { status: 422 }));
    const r = await client.callTool({ name: "levra_quote_open", arguments: { chainId: 196, user, symbol: "NVDA", side: "long", marginRaw: "100000000", leverageE2: 200, slippageBps: 50 } });
    expect(r.isError).toBe(true);
    expect(text(r)).toBe("NO_ROUTE: No swap route for this size.");
  });

  it("refuses a bad argument before calling the API", async () => {
    const { client, seen } = await connect(() => Response.json({}));
    const r = await client.callTool({ name: "levra_markets", arguments: { chainId: 1 } });
    expect(r.isError).toBe(true);
    expect(seen).toHaveLength(0);
  });

  it("reports an API that does not answer", async () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await createLevraServer(createLevraApi("https://api.levra.test", { fetchFn: down })).connect(serverSide);
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(clientSide);
    const r = await client.callTool({ name: "levra_chains", arguments: {} });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/^UPSTREAM_ERROR/);
  });
});

describe("Levra MCP over Streamable HTTP", () => {
  let server: Server;
  let base: string;
  let seen: Seen[];
  beforeAll(async () => {
    const fake = fakeFetch(() => Response.json({ chains: [] }));
    seen = fake.seen;
    const handler = createHttpHandler((headers) => createLevraApi("https://api.levra.test", { fetchFn: fake.fetchFn, headers }), "x-forwarded-for");
    server = createServer((req, res) => void handler(req, res));
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((done) => server.close(() => done())));

  it("serves tool calls statelessly and answers health", async () => {
    for (const ip of ["203.0.113.7", "198.51.100.9"]) {
      const client = new Client({ name: "test", version: "1.0.0" });
      const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { "x-forwarded-for": `10.9.9.9, ${ip}` } } });
      await client.connect(transport);
      const r = await client.callTool({ name: "levra_chains", arguments: {} });
      expect(JSON.parse(text(r))).toEqual({ chains: [] });
      expect(seen.at(-1)?.ip).toBe(ip);
      await client.close();
    }
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ ok: true });
    expect((await fetch(`${base}/other`)).status).toBe(404);
    expect((await fetch(`${base}/mcp`)).status).toBe(405);
  });

  it("refuses a body that is not JSON or too large", async () => {
    const post = (body: string) => fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body });
    expect((await post("{nope")).status).toBe(400);
    expect((await post(JSON.stringify({ pad: "x".repeat(70_000) }))).status).toBe(400);
  });
});
