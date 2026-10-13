import { quoteCloseRequest, quoteCollateralRequest, quoteOpenRequest } from "@levra/shared/api";
import { Hono } from "hono";
import { z } from "zod";
import type { ChainReader } from "../chain/reader";
import { ApiHttpError } from "../errors";
import { quoteCloseLong } from "../quotes/close-long";
import { quoteCloseShort } from "../quotes/close-short";
import { quoteCollateral } from "../quotes/collateral";
import { quoteOpenLong } from "../quotes/open-long";
import { quoteOpenShort } from "../quotes/open-short";
import type { EventStore } from "../positions/events";
import type { SwapSource } from "@levra/kyber";
import type { Compliance } from "./compliance";

export async function body<T extends z.ZodType>(schema: T, raw: Promise<unknown>): Promise<z.infer<T>> {
  const parsed = schema.safeParse(await raw.catch(() => undefined));
  if (!parsed.success) throw new ApiHttpError("BAD_REQUEST", "Invalid request body.", z.flattenError(parsed.error));
  return parsed.data;
}

/**
 * With `compliance`, opening a position needs an allowed region and accepted terms (BE-52). Closing, reducing and
 * collateral are never gated: they must always work (CLAUDE.md, product rules).
 */
export function quoteRoutes(reader: ChainReader, swap: SwapSource, events: EventStore, compliance?: Compliance) {
  const app = new Hono();
  const deps = { reader, swap, events };

  app.post("/v1/quote/open", async (c) => {
    const req = await body(quoteOpenRequest, c.req.json());
    if (compliance) await compliance.require(c, req.user);
    return c.json(req.side === "short" ? await quoteOpenShort(deps, req) : await quoteOpenLong(deps, req));
  });

  app.post("/v1/quote/close", async (c) => {
    const req = await body(quoteCloseRequest, c.req.json());
    // The side comes from the deployment file, so an unknown market falls through to the long engine's NOT_FOUND.
    const market = reader.deployment.markets.find((m) => m.marketId.toLowerCase() === req.marketId.toLowerCase());
    return c.json(market?.side === "short" ? await quoteCloseShort(deps, req) : await quoteCloseLong(deps, req));
  });

  app.post("/v1/quote/collateral", async (c) => c.json(await quoteCollateral(reader, await body(quoteCollateralRequest, c.req.json()))));

  return app;
}
