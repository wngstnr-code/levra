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

/**
 * One row per Morpho event in our markets. `user` is the position owner (`onBehalf`, or `borrower` for `Liquidate`).
 * `args` holds the decoded event with every integer as a decimal string.
 */
export const morphoEvents = pgTable(
  "morpho_events",
  {
    name: text("name").notNull(),
    marketId: text("market_id").notNull(),
    user: text("user").notNull(),
    args: jsonb("args").$type<Record<string, string | number | boolean>>().notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockTime: timestamp("block_time", { withTimezone: true }).notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
  },
  (t) => [
    uniqueIndex("morpho_events_log").on(t.txHash, t.logIndex),
    index("morpho_events_user_order").on(t.user, t.blockNumber, t.logIndex),
    index("morpho_events_market").on(t.marketId),
  ],
);

/**
 * DEX quotes from the aggregator (BE-04). `kind` is `mid` (10 USDC probe), `buy` (USDC in) or `sell` (stock in).
 * Prices have 8 decimals; `priceImpactBps` is against the mid price, worse for the trader when positive;
 * `deviationBps` is the execution price against the oracle price, signed. `error` is set when there was no route.
 */
export const dexQuotes = pgTable(
  "dex_quotes",
  {
    runId: text("run_id").notNull(),
    kind: text("kind").notNull(),
    symbol: text("symbol").notNull(),
    sizeUsdRaw: numeric("size_usd_raw", { precision: 78, scale: 0 }).notNull(),
    amountIn: numeric("amount_in", { precision: 78, scale: 0 }).notNull(),
    amountOut: numeric("amount_out", { precision: 78, scale: 0 }),
    execPriceE8: numeric("exec_price_e8", { precision: 78, scale: 0 }),
    midPriceE8: numeric("mid_price_e8", { precision: 78, scale: 0 }),
    oraclePriceE8: numeric("oracle_price_e8", { precision: 78, scale: 0 }).notNull(),
    priceImpactBps: integer("price_impact_bps"),
    deviationBps: integer("deviation_bps"),
    error: text("error"),
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("dex_quotes_latest").on(t.symbol, t.kind, t.measuredAt)],
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
