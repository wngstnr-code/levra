CREATE TABLE "oracle_updates" (
	"symbol" text NOT NULL,
	"price_id" text NOT NULL,
	"round_id" numeric(30, 0) NOT NULL,
	"price_e8" numeric(78, 0) NOT NULL,
	"best_bid_e8" numeric(78, 0) NOT NULL,
	"best_ask_e8" numeric(78, 0) NOT NULL,
	"session" text NOT NULL,
	"feed_updated_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"block_number" bigint NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_cursors" (
	"name" text PRIMARY KEY NOT NULL,
	"last_block" bigint NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "oracle_updates_log" ON "oracle_updates" USING btree ("tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "oracle_updates_symbol_time" ON "oracle_updates" USING btree ("symbol","block_time");