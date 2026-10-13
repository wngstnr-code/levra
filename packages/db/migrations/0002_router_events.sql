CREATE TABLE "router_events" (
	"name" text NOT NULL,
	"user" text NOT NULL,
	"market_id" text NOT NULL,
	"args" jsonb NOT NULL,
	"block_number" bigint NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "router_events_log" ON "router_events" USING btree ("tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "router_events_user_order" ON "router_events" USING btree ("user","block_number","log_index");