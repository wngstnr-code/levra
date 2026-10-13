import { quoteCloseRequest, quoteCollateralRequest, quoteOpenRequest } from "@levra/shared/api";
import { Hono } from "hono";
import { z } from "zod";
import type { ChainReader } from "../chain/reader";
import { ApiHttpError } from "../errors";
import { quoteCloseLong } from "../quotes/close-long";
import { quoteCollateral } from "../quotes/collateral";
import { quoteOpenLong } from "../quotes/open-long";
import type { EventStore } from "../positions/events";
import type { SwapSource } from "../swap/kyber";

async function body<T extends z.ZodType>(schema: T, raw: Promise<unknown>): Promise<z.infer<T>> {
  const parsed = schema.safeParse(await raw.catch(() => undefined));
  if (!parsed.success) throw new ApiHttpError("BAD_REQUEST", "Invalid request body.", z.flattenError(parsed.error));
  return parsed.data;
}

export function quoteRoutes(reader: ChainReader, swap: SwapSource, events: EventStore) {
  const app = new Hono();

  app.post("/v1/quote/open", async (c) => {
    const req = await body(quoteOpenRequest, c.req.json());
    if (req.side === "short") throw new ApiHttpError("BAD_REQUEST", "Short quotes are not available yet.");
    return c.json(await quoteOpenLong({ reader, swap, events }, req));
  });

  app.post("/v1/quote/close", async (c) => c.json(await quoteCloseLong({ reader, swap, events }, await body(quoteCloseRequest, c.req.json()))));

  app.post("/v1/quote/collateral", async (c) => c.json(await quoteCollateral(reader, await body(quoteCollateralRequest, c.req.json()))));

  return app;
}
