import { preparedActions, type Db } from "@levra/db";
import { tokensByChain } from "@levra/shared/addresses";
import {
  apiError,
  prepareRequest,
  preparedAction,
  quoteCloseResponse,
  quoteOpenResponse,
  type PrepareRequest,
  type PrepareResponse,
  type PreparedResponse,
} from "@levra/shared/api";
import type { DeployedMarket, Deployment } from "@levra/shared/deployments";
import { eq, lt } from "drizzle-orm";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { getAddress } from "viem";
import { z } from "zod";
import { ApiHttpError } from "../errors";

/** Initial proposal: a prepared action can be opened for an hour; rows are deleted a day after they expire. */
export const PREPARED_TTL_SECONDS = 3_600;
const PRUNE_AFTER_MS = 24 * 3_600_000;

/** Sends a quote request through the chain's own quote route, with the caller's headers (region and terms gate). */
export type QuoteThrough = (path: string, body: unknown, headers: Headers) => Promise<Response>;

const usd = (raw: string | bigint) => {
  const v = BigInt(raw);
  const cents = (v + 5_000n) / 10_000n;
  return `${(cents / 100n).toLocaleString("en-US")}.${(cents % 100n).toString().padStart(2, "0")}`;
};
const percent = (wad: string) => {
  const bps = (BigInt(wad) * 10_000n) / 10n ** 18n;
  return bps % 100n === 0n ? `${bps / 100n}%` : `${(Number(bps) / 100).toFixed(2)}%`;
};

/** Only the quote fields a summary uses; the full shapes are checked by the quote routes and their tests. */
const openPreview = z.object({ preview: quoteOpenResponse.shape.preview.pick({ liqPriceE8: true }) });
const closePreview = z.object({ preview: quoteCloseResponse.shape.preview.pick({ returnedRaw: true }) });

function marketOf(deployment: Deployment, marketId: string): DeployedMarket {
  const m = deployment.markets.find((x) => x.marketId.toLowerCase() === marketId.toLowerCase());
  if (!m) throw new ApiHttpError("BAD_REQUEST", "No Levra market with this ID on this chain.");
  return m;
}

/** One plain sentence for the chat, from the request and the quote made now. */
export function summarize(deployment: Deployment, action: PrepareRequest, quote: unknown): string {
  const usdc = tokensByChain[deployment.chainId as keyof typeof tokensByChain]?.USDC.address.toLowerCase();
  if (action.kind === "open") {
    const r = action.request;
    const q = openPreview.parse(quote);
    const lev = (r.leverageE2 / 100).toFixed(2);
    return `Open a ${lev}x ${r.side} on ${r.symbol} with ${usd(r.marginRaw)} USDC of margin; liquidation price about $${usd(BigInt(q.preview.liqPriceE8) / 100n)} at today's quote.`;
  }
  if (action.kind === "close") {
    const r = action.request;
    const m = marketOf(deployment, r.marketId);
    const q = closePreview.parse(quote);
    return `Close ${percent(r.fractionWad)} of the ${m.symbol} ${m.side}; about ${usd(q.preview.returnedRaw)} USDC comes back at today's quote.`;
  }
  const r = action.request;
  const m = marketOf(deployment, r.marketId);
  const token = r.action === "repay" ? m.loanToken : m.collateralToken;
  const amount = token.toLowerCase() === usdc ? `${usd(r.amountRaw)} USDC` : `${r.amountRaw} base units of ${m.symbol}`;
  if (r.action === "add") return `Add ${amount} of collateral to the ${m.symbol} ${m.side}.`;
  if (r.action === "remove") return `Take ${amount} of collateral out of the ${m.symbol} ${m.side}.`;
  return `Repay ${amount} of debt on the ${m.symbol} ${m.side}.`;
}

const QUOTE_PATH = { open: "/v1/quote/open", close: "/v1/quote/close", collateral: "/v1/quote/collateral" } as const;

/** `POST /v1/:chainId/agent/prepare` (BE-77): checks the request with a real quote, stores it, returns the app link. */
export function agentRoutes(deployment: Deployment, db: Db, quoteThrough: QuoteThrough, webAppUrl: string, now: () => number = Date.now) {
  const app = new Hono();
  app.post("/v1/agent/prepare", async (c) => {
    const parsed = prepareRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new ApiHttpError("BAD_REQUEST", "Invalid prepared action.", parsed.error.issues);
    const action = parsed.data;

    const res = await quoteThrough(QUOTE_PATH[action.kind], action.request, c.req.raw.headers);
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const err = apiError.safeParse(body);
      if (err.success) throw new ApiHttpError(err.data.error.code, err.data.error.message, err.data.error.details);
      throw new ApiHttpError("UPSTREAM_ERROR", "The quote for this action failed.");
    }
    const summary = summarize(deployment, action, body);

    const id = randomUUID();
    const created = new Date(now());
    const expires = new Date(created.getTime() + PREPARED_TTL_SECONDS * 1000);
    await db.delete(preparedActions).where(lt(preparedActions.expiresAt, new Date(created.getTime() - PRUNE_AFTER_MS)));
    await db.insert(preparedActions).values({
      id,
      chainId: deployment.chainId,
      kind: action.kind,
      user: action.request.user.toLowerCase(),
      request: action.request,
      summary,
      createdAt: created,
      expiresAt: expires,
    });
    const url = new URL(`/prepared/${id}`, webAppUrl).toString();
    return c.json({ id, url, expiresAt: Math.floor(expires.getTime() / 1000), summary } satisfies PrepareResponse);
  });
  return app;
}

/** `GET /v1/prepared/:id`: what the app shows and quotes again before the wallet signs. */
export function preparedRoutes(db: Db, now: () => number = Date.now) {
  const app = new Hono();
  app.get("/v1/prepared/:id", async (c) => {
    const id = c.req.param("id");
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new ApiHttpError("NOT_FOUND", "No such prepared action.");
    const [row] = await db.select().from(preparedActions).where(eq(preparedActions.id, id));
    if (!row) throw new ApiHttpError("NOT_FOUND", "No such prepared action.");
    if (row.expiresAt.getTime() <= now()) throw new ApiHttpError("QUOTE_EXPIRED", "This prepared action has expired. Ask the agent again.");
    const action = preparedAction.parse({ kind: row.kind, request: row.request });
    return c.json({
      ...action,
      id: row.id,
      chainId: row.chainId,
      user: getAddress(row.user),
      summary: row.summary,
      createdAt: Math.floor(row.createdAt.getTime() / 1000),
      expiresAt: Math.floor(row.expiresAt.getTime() / 1000),
    } satisfies PreparedResponse);
  });
  return app;
}
