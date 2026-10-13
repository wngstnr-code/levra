CREATE TABLE "morpho_events" (
	"name" text NOT NULL,
	"market_id" text NOT NULL,
	"user" text NOT NULL,
	"args" jsonb NOT NULL,
	"block_number" bigint NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "morpho_events_log" ON "morpho_events" USING btree ("tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "morpho_events_user_order" ON "morpho_events" USING btree ("user","block_number","log_index");--> statement-breakpoint
CREATE INDEX "morpho_events_market" ON "morpho_events" USING btree ("market_id");