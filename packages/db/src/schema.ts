import { bigint, boolean, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

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

/**
 * One row per ERC-4626 `Deposit` or `Withdraw` of the USDC vault (BE-22). `user` is the share owner.
 * `args` holds the decoded event with every integer as a decimal string.
 */
export const vaultEvents = pgTable(
  "vault_events",
  {
    name: text("name").notNull(),
    vault: text("vault").notNull(),
    user: text("user").notNull(),
    args: jsonb("args").$type<Record<string, string | number | boolean>>().notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockTime: timestamp("block_time", { withTimezone: true }).notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
  },
  (t) => [uniqueIndex("vault_events_log").on(t.txHash, t.logIndex), index("vault_events_user_order").on(t.user, t.blockNumber, t.logIndex)],
);

/** Rate snapshot per market from `Lens`, written by the depth keeper on each run (BE-23). Ratios WAD. */
export const marketRates = pgTable(
  "market_rates",
  {
    marketId: text("market_id").notNull(),
    symbol: text("symbol").notNull(),
    side: text("side").notNull(),
    borrowApyWad: numeric("borrow_apy_wad", { precision: 78, scale: 0 }).notNull(),
    supplyApyWad: numeric("supply_apy_wad", { precision: 78, scale: 0 }).notNull(),
    utilizationWad: numeric("utilization_wad", { precision: 78, scale: 0 }).notNull(),
    totalSupplyRaw: numeric("total_supply_raw", { precision: 78, scale: 0 }).notNull(),
    totalBorrowRaw: numeric("total_borrow_raw", { precision: 78, scale: 0 }).notNull(),
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("market_rates_market_time").on(t.marketId, t.measuredAt)],
);

/** One row per sign-in nonce (BE-33). A nonce is used once. */
export const authNonces = pgTable("auth_nonces", {
  nonce: text("nonce").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

/** Alert choices per wallet (BE-33). Only what is needed: the address, the choices, an email if given (07). */
export const alertSettings = pgTable("alert_settings", {
  address: text("address").primaryKey(),
  email: text("email"),
  telegramChatId: text("telegram_chat_id"),
  preClose: boolean("pre_close").notNull(),
  ltvThresholdWad: numeric("ltv_threshold_wad", { precision: 78, scale: 0 }),
  autoDeleverage: boolean("auto_deleverage").notNull(),
  liquidation: boolean("liquidation").notNull(),
  depositArrived: boolean("deposit_arrived").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

/**
 * One-time codes that link a Telegram chat to a wallet (BE-33). The API hands out the code in a t.me start link; the
 * alerts keeper sees `/start <code>` from the bot and stores the chat id in `alert_settings`.
 */
export const telegramLinks = pgTable("telegram_links", {
  code: text("code").primaryKey(),
  address: text("address").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

/**
 * State of each team monitor check (BE-50). `since` is when the condition last became true, `notified` whether the team
 * has been told, `value` the last value seen for checks that alert on a change (risk values posted by keepers).
 */
export const monitorState = pgTable("monitor_state", {
  key: text("key").primaryKey(),
  active: boolean("active").notNull(),
  since: timestamp("since", { withTimezone: true }),
  notified: boolean("notified").notNull(),
  value: text("value"),
  message: text("message"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

/** Alerts already sent, so each one goes out once per channel (BE-33). */
export const alertDeliveries = pgTable(
  "alert_deliveries",
  {
    address: text("address").notNull(),
    key: text("key").notNull(),
    channel: text("channel").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.address, t.key, t.channel] })],
);

/**
 * Cross-chain transfers through the 1Click API (BE-40, BE-41): `deposit` into USDC on Monad, or `withdraw` out of it.
 * `quote` keeps the whole signed quote, which 1Click asks us to keep for disputes.
 */
export const deposits = pgTable(
  "deposits",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    user: text("user").notNull(),
    originAsset: text("origin_asset").notNull(),
    destinationAsset: text("destination_asset").notNull(),
    amountInRaw: numeric("amount_in_raw", { precision: 78, scale: 0 }).notNull(),
    quotedOutRaw: numeric("quoted_out_raw", { precision: 78, scale: 0 }).notNull(),
    depositAddress: text("deposit_address").notNull(),
    depositMemo: text("deposit_memo"),
    recipient: text("recipient").notNull(),
    refundTo: text("refund_to").notNull(),
    status: text("status").notNull(),
    upstreamStatus: text("upstream_status"),
    originTxHash: text("origin_tx_hash"),
    destinationTxHash: text("destination_tx_hash"),
    amountOutRaw: numeric("amount_out_raw", { precision: 78, scale: 0 }),
    quote: jsonb("quote").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
  },
  (t) => [index("deposits_open").on(t.status, t.checkedAt), index("deposits_user").on(t.user)],
);

/** Signed acceptance of a terms version per wallet (BE-52). */
export const termsAcceptances = pgTable(
  "terms_acceptances",
  {
    address: text("address").notNull(),
    termsVersion: text("terms_version").notNull(),
    signature: text("signature").notNull(),
    country: text("country"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.address, t.termsVersion] })],
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
