-- BE-95: every table with chain data gets chain_id. Rows written before this migration are Monad's (143).
-- The default exists only to fill those rows; it is dropped so every new write must name its chain.
ALTER TABLE "dex_quotes" ADD COLUMN "chain_id" integer NOT NULL DEFAULT 143;--> statement-breakpoint
ALTER TABLE "dex_quotes" ALTER COLUMN "chain_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "chain_id" integer NOT NULL DEFAULT 143;--> statement-breakpoint
ALTER TABLE "deposits" ALTER COLUMN "chain_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "keeper_heartbeats" ADD COLUMN "chain_id" integer NOT NULL DEFAULT 143;--> statement-breakpoint
ALTER TABLE "keeper_heartbeats" ALTER COLUMN "chain_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "market_rates" ADD COLUMN "chain_id" integer NOT NULL DEFAULT 143;--> statement-breakpoint
ALTER TABLE "market_rates" ALTER COLUMN "chain_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "monitor_state" ADD COLUMN "chain_id" integer NOT NULL DEFAULT 143;--> statement-breakpoint
ALTER TABLE "monitor_state" ALTER COLUMN "chain_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "morpho_events" ADD COLUMN "chain_id" integer NOT NULL DEFAULT 143;--> statement-breakpoint
ALTER TABLE "morpho_events" ALTER COLUMN "chain_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "oracle_updates" ADD COLUMN "chain_id" integer NOT NULL DEFAULT 143;--> statement-breakpoint
ALTER TABLE "oracle_updates" ALTER COLUMN "chain_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "router_events" ADD COLUMN "chain_id" integer NOT NULL DEFAULT 143;--> statement-breakpoint
ALTER TABLE "router_events" ALTER COLUMN "chain_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "sync_cursors" ADD COLUMN "chain_id" integer NOT NULL DEFAULT 143;--> statement-breakpoint
ALTER TABLE "sync_cursors" ALTER COLUMN "chain_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "vault_events" ADD COLUMN "chain_id" integer NOT NULL DEFAULT 143;--> statement-breakpoint
ALTER TABLE "vault_events" ALTER COLUMN "chain_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "keeper_heartbeats" DROP CONSTRAINT "keeper_heartbeats_pkey";--> statement-breakpoint
ALTER TABLE "monitor_state" DROP CONSTRAINT "monitor_state_pkey";--> statement-breakpoint
ALTER TABLE "sync_cursors" DROP CONSTRAINT "sync_cursors_pkey";--> statement-breakpoint
ALTER TABLE "keeper_heartbeats" ADD CONSTRAINT "keeper_heartbeats_chain_id_name_pk" PRIMARY KEY("chain_id","name");--> statement-breakpoint
ALTER TABLE "monitor_state" ADD CONSTRAINT "monitor_state_chain_id_key_pk" PRIMARY KEY("chain_id","key");--> statement-breakpoint
ALTER TABLE "sync_cursors" ADD CONSTRAINT "sync_cursors_chain_id_name_pk" PRIMARY KEY("chain_id","name");--> statement-breakpoint
DROP INDEX "dex_quotes_latest";--> statement-breakpoint
DROP INDEX "market_rates_market_time";--> statement-breakpoint
DROP INDEX "morpho_events_log";--> statement-breakpoint
DROP INDEX "morpho_events_user_order";--> statement-breakpoint
DROP INDEX "morpho_events_market";--> statement-breakpoint
DROP INDEX "oracle_updates_log";--> statement-breakpoint
DROP INDEX "oracle_updates_symbol_time";--> statement-breakpoint
DROP INDEX "router_events_log";--> statement-breakpoint
DROP INDEX "router_events_user_order";--> statement-breakpoint
DROP INDEX "vault_events_log";--> statement-breakpoint
DROP INDEX "vault_events_user_order";--> statement-breakpoint
CREATE INDEX "dex_quotes_latest" ON "dex_quotes" USING btree ("chain_id","symbol","kind","measured_at");--> statement-breakpoint
CREATE INDEX "market_rates_market_time" ON "market_rates" USING btree ("chain_id","market_id","measured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "morpho_events_log" ON "morpho_events" USING btree ("chain_id","tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "morpho_events_user_order" ON "morpho_events" USING btree ("chain_id","user","block_number","log_index");--> statement-breakpoint
CREATE INDEX "morpho_events_market" ON "morpho_events" USING btree ("chain_id","market_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oracle_updates_log" ON "oracle_updates" USING btree ("chain_id","tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "oracle_updates_symbol_time" ON "oracle_updates" USING btree ("chain_id","symbol","block_time");--> statement-breakpoint
CREATE UNIQUE INDEX "router_events_log" ON "router_events" USING btree ("chain_id","tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "router_events_user_order" ON "router_events" USING btree ("chain_id","user","block_number","log_index");--> statement-breakpoint
CREATE UNIQUE INDEX "vault_events_log" ON "vault_events" USING btree ("chain_id","tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "vault_events_user_order" ON "vault_events" USING btree ("chain_id","user","block_number","log_index");
