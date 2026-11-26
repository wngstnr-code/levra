import { createDb, preparedActions, runMigrations } from "@levra/db";
import { tokensByChain } from "@levra/shared/addresses";
import { prepareResponse, preparedResponse, type PrepareRequest } from "@levra/shared/api";
import type { Deployment } from "@levra/shared/deployments";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { getAddress } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentRoutes, preparedRoutes, summarize, type QuoteThrough } from "../src/routes/agent";

const user = getAddress("0x00000000000000000000000000000000000a6e77");
const USDC = tokensByChain[196].USDC.address;
const STOCK = getAddress("0x00000000000000000000000000000000005d0c4a");
const longId = `0x${"11".repeat(32)}` as const;
const shortId = `0x${"22".repeat(32)}` as const;
const deployment = {
  chainId: 196,
  block: 1,
  router: STOCK,
  riskManager: STOCK,
  lens: STOCK,
  markets: [
    { symbol: "NVDA", side: "long", marketId: longId, oracle: STOCK, collateralToken: STOCK, loanToken: USDC, lltv: "770000000000000000" },
    { symbol: "NVDA", side: "short", marketId: shortId, oracle: STOCK, collateralToken: USDC, loanToken: STOCK, lltv: "770000000000000000" },
  ],
} as Deployment;

const closeQuote = { quoteId: "q", expiresAt: 1, preview: { returnedRaw: "99504999" } };
const openQuote = { quoteId: "q", expiresAt: 1, preview: { liqPriceE8: "9512340000" } };

describe("prepared action summaries (BE-77)", () => {
  it("says what an open, a close and each collateral action does", () => {
    const open: PrepareRequest = { kind: "open", request: { user, symbol: "NVDA", side: "long", marginRaw: "100000000", leverageE2: 200, slippageBps: 50 } };
    expect(summarize(deployment, open, openQuote).startsWith("Open a 2.00x long on NVDA with 100.00 USDC of margin")).toBe(true);
    const close: PrepareRequest = { kind: "close", request: { user, marketId: longId, fractionWad: "500000000000000000", slippageBps: 50 } };
    expect(summarize(deployment, close, closeQuote)).toBe("Close 50% of the NVDA long; about 99.50 USDC comes back at today's quote.");
    const add = (action: "add" | "remove" | "repay", marketId: `0x${string}`) =>
      summarize(deployment, { kind: "collateral", request: { user, marketId, action, amountRaw: "25000000" } }, {});
    expect(add("add", shortId)).toBe("Add 25.00 USDC of collateral to the NVDA short.");
    expect(add("repay", longId)).toBe("Repay 25.00 USDC of debt on the NVDA long.");
    expect(add("remove", longId)).toBe("Take 25000000 base units of NVDA of collateral out of the NVDA long.");
  });

  it("refuses a market that is not ours", () => {
    const close: PrepareRequest = { kind: "close", request: { user, marketId: `0x${"33".repeat(32)}`, fractionWad: "1000000000000000000", slippageBps: 50 } };
    expect(() => summarize(deployment, close, closeQuote)).toThrow(/No Levra market/);
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("prepare and open a prepared action (needs TEST_DATABASE_URL)", () => {
  const { db, close } = createDb(url ?? "", { max: 2 });
  let clock = Date.parse("2026-11-24T10:00:00Z");
  const asked: { path: string; body: unknown; country: string | null }[] = [];
  let answer: Response = Response.json(closeQuote);
  const quoteThrough: QuoteThrough = async (path, body, headers) => {
    asked.push({ path, body, country: headers.get("cf-ipcountry") });
    return answer.clone();
  };
  const app = new Hono();
  app.route("/", agentRoutes(deployment, db, quoteThrough, "https://app.levra.finance", () => clock));
  app.route("/", preparedRoutes(db, () => clock));
  app.onError((err, c) => c.json({ error: { code: (err as { code?: string }).code ?? "INTERNAL", message: err.message } }, ((err as { status?: number }).status ?? 500) as 400));
  const prepare = (body: unknown) => app.request("/v1/agent/prepare", { method: "POST", headers: { "content-type": "application/json", "cf-ipcountry": "ID" }, body: JSON.stringify(body) });

  beforeAll(async () => {
    await runMigrations(url ?? "");
    await db.delete(preparedActions).where(eq(preparedActions.user, user.toLowerCase()));
  });
  afterAll(() => close());

  it("quotes the close through the chain's route, stores it and links to the app", async () => {
    const res = await prepare({ kind: "close", request: { user, marketId: longId, fractionWad: "1000000000000000000", slippageBps: 50 } });
    expect(res.status).toBe(200);
    const p = prepareResponse.parse(await res.json());
    expect(p.url).toBe(`https://app.levra.finance/prepared/${p.id}`);
    expect(p.summary).toBe("Close 100% of the NVDA long; about 99.50 USDC comes back at today's quote.");
    expect(asked.at(-1)).toMatchObject({ path: "/v1/quote/close", country: "ID" });

    const got = preparedResponse.parse(await (await app.request(`/v1/prepared/${p.id}`)).json());
    expect(got).toMatchObject({ id: p.id, chainId: 196, kind: "close", user, request: { marketId: longId, fractionWad: "1000000000000000000" } });

    clock += 3_600_000;
    expect((await app.request(`/v1/prepared/${p.id}`)).status).toBe(409);
  });

  it("passes the quote's refusal on and stores nothing", async () => {
    answer = Response.json({ error: { code: "TERMS_NOT_ACCEPTED", message: "Accept the terms first." } }, { status: 403 });
    const res = await prepare({ kind: "open", request: { user, symbol: "NVDA", side: "long", marginRaw: "100000000", leverageE2: 200, slippageBps: 50 } });
    expect(res.status).toBe(403);
    const rows = await db.select().from(preparedActions).where(eq(preparedActions.kind, "open"));
    expect(rows.filter((r) => r.user === user.toLowerCase())).toHaveLength(0);
  });

  it("adds the circuit check on X Layer only (BE-87)", async () => {
    answer = Response.json(closeQuote);
    const body = { kind: "close", request: { user, marketId: longId, fractionWad: "1000000000000000000", slippageBps: 50 } };
    const check = { risk: null, gap: null, clock: null };
    const seen: unknown[] = [];
    const xlayer = new Hono();
    xlayer.route(
      "/",
      agentRoutes(deployment, db, quoteThrough, "https://app.levra.finance", () => clock, async (action, quote) => {
        seen.push({ action, quote });
        return check;
      }),
    );
    const res = await xlayer.request("/v1/agent/prepare", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect(prepareResponse.parse(await res.json()).circuitCheck).toEqual(check);
    expect(seen).toEqual([{ action: body, quote: closeQuote }]);

    expect(prepareResponse.parse(await (await prepare(body)).json())).not.toHaveProperty("circuitCheck");
  });

  it("refuses a bad body and an unknown id", async () => {
    expect((await prepare({ kind: "swap", request: {} })).status).toBe(400);
    expect((await app.request("/v1/prepared/00000000-0000-0000-0000-000000000000")).status).toBe(404);
    expect((await app.request("/v1/prepared/nope")).status).toBe(404);
  });
});
