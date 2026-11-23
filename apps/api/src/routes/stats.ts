import type { Db } from "@levra/db";
import { Hono } from "hono";
import type { ChainReader } from "../chain/reader";
import { upstream } from "../errors";
import { createStats } from "../stats/stats";

export function statsRoutes(reader: ChainReader, db: Db) {
  const app = new Hono();
  const stats = createStats(reader, db);
  app.get("/v1/stats", async (c) => c.json(await upstream(stats)));
  return app;
}
