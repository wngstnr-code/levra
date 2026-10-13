import { bigint, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const keeperHeartbeats = pgTable("keeper_heartbeats", {
  name: text("name").primaryKey(),
  lastBeatAt: timestamp("last_beat_at", { withTimezone: true }).notNull(),
  lastError: text("last_error"),
  details: jsonb("details"),
});

/** Last block fully read by each log follower. */
export const syncCursors = pgTable("sync_cursors", {
  name: text("name").primaryKey(),
  lastBlock: bigint("last_block", { mode: "bigint" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

/**
 * One row per MarginRouter event. `args` holds the decoded event with every integer as a decimal string.
 * The chain is the source of truth; this table is a copy for history and cost basis.
 */
export const routerEvents = pgTable(
  "router_events",
  {
    name: text("name").notNull(),
    user: text("user").notNull(),
    marketId: text("market_id").notNull(),
    args: jsonb("args").$type<Record<string, string | number | boolean>>().notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockTime: timestamp("block_time", { withTimezone: true }).notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
  },
  (t) => [
    uniqueIndex("router_events_log").on(t.txHash, t.logIndex),
    index("router_events_user_order").on(t.user, t.blockNumber, t.logIndex),
  ],
);

/** One row per `PriceUpdated` log of the Anchored oracle for our stocks. Prices have 8 decimals. */
export const oracleUpdates = pgTable(
  "oracle_updates",
  {
    symbol: text("symbol").notNull(),
    priceId: text("price_id").notNull(),
    roundId: numeric("round_id", { precision: 30, scale: 0 }).notNull(),
    priceE8: numeric("price_e8", { precision: 78, scale: 0 }).notNull(),
    bestBidE8: numeric("best_bid_e8", { precision: 78, scale: 0 }).notNull(),
    bestAskE8: numeric("best_ask_e8", { precision: 78, scale: 0 }).notNull(),
    session: text("session").notNull(),
    feedUpdatedAt: timestamp("feed_updated_at", { withTimezone: true }).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockTime: timestamp("block_time", { withTimezone: true }).notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
  },
  (t) => [
    uniqueIndex("oracle_updates_log").on(t.txHash, t.logIndex),
    index("oracle_updates_symbol_time").on(t.symbol, t.blockTime),
  ],
);
