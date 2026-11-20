ALTER TABLE "oracle_updates" ALTER COLUMN "best_bid_e8" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "oracle_updates" ALTER COLUMN "best_ask_e8" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "oracle_updates" ALTER COLUMN "session" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "oracle_updates" ALTER COLUMN "block_number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "oracle_updates" ALTER COLUMN "tx_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "oracle_updates" ALTER COLUMN "log_index" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "oracle_updates_round" ON "oracle_updates" USING btree ("chain_id","price_id","round_id") WHERE "oracle_updates"."tx_hash" is null;