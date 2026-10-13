import { z } from "zod";
import { symbol, unixSeconds } from "./primitives";

export const healthResponse = z.object({
  ok: z.literal(true),
});
export type HealthResponse = z.infer<typeof healthResponse>;

export const keeperName = z.enum(["calendar", "protector", "liquidator", "alerts", "oracleMonitor", "oracleAgePoster", "marketDepth", "transfers", "monitor"]);
export type KeeperName = z.infer<typeof keeperName>;

/**
 * A keeper is healthy when its last heartbeat is newer than this and carries no error. Initial proposal (08 says "a few
 * minutes"); the oracle age poster runs hourly, so it gets two hours; the calendar poster and market depth run every
 * 10 minutes, so they get 30. Used by `/v1/status` and the team monitor (BE-50).
 */
export const KEEPER_HEARTBEAT_LIMIT_S: Record<KeeperName, number> = {
  calendar: 1_800,
  protector: 300,
  liquidator: 300,
  alerts: 300,
  oracleMonitor: 300,
  oracleAgePoster: 7_200,
  marketDepth: 1_800,
  transfers: 300,
  monitor: 300,
};

export const statusResponse = z.object({
  oracle: z.array(
    z.object({
      symbol,
      publishedAt: unixSeconds,
      ageSeconds: z.number().int().nonnegative(),
      stale: z.boolean(),
      /** The team monitor's "price too old" limit for the current session (BE-50); null before the monitor has run. */
      ageLimitSeconds: z.number().int().positive().nullable().optional(),
      /** True while that session has too few samples and the strict default applies. */
      ageLimitLearning: z.boolean().optional(),
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
