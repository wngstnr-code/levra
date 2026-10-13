import type { EarnResponse } from "@levra/shared/api";
import { Hono } from "hono";
import type { ChainReader } from "../chain/reader";
import { createEarn } from "../earn/earn";
import { upstream } from "../errors";
import type { EventStore } from "../positions/events";
import { userParam } from "./accounts";

export function earnRoutes(reader: ChainReader, events: EventStore) {
  const app = new Hono();
  const earn = createEarn(reader);

  app.get("/v1/earn", async (c) => c.json({ options: await upstream(earn.options) } satisfies EarnResponse));

  app.get("/v1/earn/:address", async (c) => {
    const user = userParam(c.req.param("address"));
    const stored = await upstream(() => events.forUser(user));
    return c.json(await upstream(() => earn.account(user, stored)));
  });

  return app;
}