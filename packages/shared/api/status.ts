import { z } from "zod";
import { symbol, unixSeconds } from "./primitives";

export const healthResponse = z.object({
  ok: z.literal(true),
});
export type HealthResponse = z.infer<typeof healthResponse>;

export const keeperName = z.enum(["calendar", "protector", "liquidator", "alerts", "oracleMonitor", "oracleAgePoster", "marketDepth", "transfers"]);
export type KeeperName = z.infer<typeof keeperName>;

export const statusResponse = z.object({
  oracle: z.array(
    z.object({
      symbol,
      publishedAt: unixSeconds,
      ageSeconds: z.number().int().nonnegative(),
      stale: z.boolean(),
    }),
  ),
  keepers: z.array(
    z.object({
      name: keeperName,
      lastHeartbeatAt: unixSeconds.nullable(),
      healthy: z.boolean(),
    }),
  ),
  indexer: z.object({
    lastBlock: z.number().int().nonnegative(),
    chainHead: z.number().int().nonnegative(),
    lagBlocks: z.number().int().nonnegative(),
  }),
  api: z.object({
    version: z.string(),
  }),
});
export type StatusResponse = z.infer<typeof statusResponse>;
