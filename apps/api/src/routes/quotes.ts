import { quoteCloseRequest, quoteCollateralRequest, quoteOpenRequest, type QuoteOpenResponse } from "@levra/shared/api";
import { Hono } from "hono";
import { z } from "zod";
import { positionAmounts } from "../chain/circuits";
import type { ChainReader } from "../chain/reader";
import { ApiHttpError } from "../errors";
import { quoteCloseLong } from "../quotes/close-long";
import { quoteCloseShort } from "../quotes/close-short";
import { quoteCollateral } from "../quotes/collateral";
import { withRouteFallback, type RouteFailed } from "../quotes/fallback";
import { quoteOpenLong } from "../quotes/open-long";
import { quoteOpenShort } from "../quotes/open-short";
import type { EventStore } from "../positions/events";
import type { SwapSource } from "@levra/swap";
import type { Compliance } from "./compliance";

export async function body<T extends z.ZodType>(schema: T, raw: Promise<unknown>): Promise<z.infer<T>> {
  const parsed = schema.safeParse(await raw.catch(() => undefined));
  if (!parsed.success) throw new ApiHttpError("BAD_REQUEST", "Invalid request body.", z.flattenError(parsed.error));
  return parsed.data;
}

/** X Layer only (BE-83, D-113): the risk circuit's verdict after the quote's worst gap, next to `gapScenarios`. */
export async function withCircuitGapCheck(reader: ChainReader, q: QuoteOpenResponse): Promise<QuoteOpenResponse> {
  if (!reader.circuits) return q;
  const m = (await reader.markets()).find((x) => x.info.marketId.toLowerCase() === q.market.marketId.toLowerCase());
  const amounts = m ? positionAmounts(m, BigInt(q.preview.collateralRaw), BigInt(q.preview.debtRaw), reader.usdc.decimals) : null;
  const check = m ? await reader.circuits.gap(m, amounts, q.preview.gapScenarios[0]?.moveBps) : null;
  return { ...q, preview: { ...q.preview, circuitGapCheck: check } };
}

/**
 * With `compliance`, opening a position needs an allowed region and accepted terms (BE-52). Closing, reducing and
 * collateral are never gated: they must always work (CLAUDE.md, product rules).
 */
export function quoteRoutes(reader: ChainReader, swap: SwapSource, events: EventStore, compliance?: Compliance, onRouteFailed?: RouteFailed) {
  const app = new Hono();
  const deps = { reader, swap, events };

  app.post("/v1/quote/open", async (c) => {
    const req = await body(quoteOpenRequest, c.req.json());
    if (compliance) await compliance.require(c, req.user, reader.deployment.chainId);
    const quote = req.side === "short" ? quoteOpenShort : quoteOpenLong;
    return c.json(await withCircuitGapCheck(reader, await withRouteFallback(deps, (d) => quote(d, req), onRouteFailed)));
  });

  app.post("/v1/quote/close", async (c) => {
    const req = await body(quoteCloseRequest, c.req.json());
    // The side comes from the deployment file, so an unknown market falls through to the long engine's NOT_FOUND.
    const market = reader.deployment.markets.find((m) => m.marketId.toLowerCase() === req.marketId.toLowerCase());
    const quote = market?.side === "short" ? quoteCloseShort : quoteCloseLong;
    return c.json(await withRouteFallback(deps, (d) => quote(d, req), onRouteFailed));
  });

  app.post("/v1/quote/collateral", async (c) => c.json(await quoteCollateral(reader, await body(quoteCollateralRequest, c.req.json()))));

  return app;
}
