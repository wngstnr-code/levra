import { historyQuery } from "@levra/shared/api";
import { Hono } from "hono";
import { getAddress, isAddress, type Address } from "viem";
import type { ChainReader } from "../chain/reader";
import { ApiHttpError, upstream } from "../errors";
import { buildAccount, buildHistory, pageHistory } from "../positions/account";
import type { EventStore } from "../positions/events";

export function userParam(raw: string): Address {
  if (!isAddress(raw, { strict: false })) throw new ApiHttpError("BAD_REQUEST", "Not an address.");
  return getAddress(raw);
}

export function accountRoutes(reader: ChainReader, events: EventStore) {
  const app = new Hono();

  app.get("/v1/accounts/:address", async (c) => {
    const user = userParam(c.req.param("address"));
    const stored = await upstream(() => events.forUser(user));
    return c.json(await upstream(() => buildAccount(reader, stored, user)));
  });

  app.get("/v1/accounts/:address/history", async (c) => {
    const user = userParam(c.req.param("address"));
    const limitRaw = c.req.query("limit");
    const parsed = historyQuery.safeParse({ cursor: c.req.query("cursor"), limit: limitRaw === undefined ? undefined : Number(limitRaw) });
    if (!parsed.success) throw new ApiHttpError("BAD_REQUEST", "Invalid history query.");
    const all = buildHistory(reader, await upstream(() => events.forUser(user)));
    try {
      return c.json(pageHistory(all, parsed.data.cursor, parsed.data.limit ?? 20));
    } catch {
      throw new ApiHttpError("BAD_REQUEST", "Unknown history cursor.");
    }
  });

  return app;
}
