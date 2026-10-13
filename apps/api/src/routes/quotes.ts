import { quoteOpenRequest } from "@levra/shared/api";
import { Hono } from "hono";
import { z } from "zod";
import type { ChainReader } from "../chain/reader";
import { ApiHttpError } from "../errors";
import { quoteOpenLong } from "../quotes/open-long";
import type { SwapSource } from "../swap/kyber";

async function body<T extends z.ZodType>(schema: T, raw: Promise<unknown>): Promise<z.infer<T>> {
  const parsed = schema.safeParse(await raw.catch(() => undefined));
  if (!parsed.success) throw new ApiHttpError("BAD_REQUEST", "Invalid request body.", z.flattenError(parsed.error));
  return parsed.data;
}

export function quoteRoutes(reader: ChainReader, swap: SwapSource) {
  const app = new Hono();

  app.post("/v1/quote/open", async (c) => {
    const req = await body(quoteOpenRequest, c.req.json());
    if (req.side === "short") throw new ApiHttpError("BAD_REQUEST", "Short quotes are not available yet.");
    return c.json(await quoteOpenLong({ reader, swap }, req));
  });

  return app;
}
