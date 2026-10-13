CREATE TABLE "alert_deliveries" (
	"address" text NOT NULL,
	"key" text NOT NULL,
	"channel" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	CONSTRAINT "alert_deliveries_address_key_channel_pk" PRIMARY KEY("address","key","channel")
);
--> statement-breakpoint
CREATE TABLE "alert_settings" (
	"address" text PRIMARY KEY NOT NULL,
	"email" text,
	"telegram_chat_id" text,
	"pre_close" boolean NOT NULL,
	"ltv_threshold_wad" numeric(78, 0),
	"auto_deleverage" boolean NOT NULL,
	"liquidation" boolean NOT NULL,
	"deposit_arrived" boolean NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "deposits" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"user" text NOT NULL,
	"origin_asset" text NOT NULL,
	"destination_asset" text NOT NULL,
	"amount_in_raw" numeric(78, 0) NOT NULL,
	"quoted_out_raw" numeric(78, 0) NOT NULL,
	"deposit_address" text NOT NULL,
	"deposit_memo" text,
	"recipient" text NOT NULL,
	"refund_to" text NOT NULL,
	"status" text NOT NULL,
	"upstream_status" text,
	"origin_tx_hash" text,
	"destination_tx_hash" text,
	"amount_out_raw" numeric(78, 0),
	"quote" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"checked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "market_rates" (
	"market_id" text NOT NULL,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"borrow_apy_wad" numeric(78, 0) NOT NULL,
	"supply_apy_wad" numeric(78, 0) NOT NULL,
	"utilization_wad" numeric(78, 0) NOT NULL,
	"total_supply_raw" numeric(78, 0) NOT NULL,
	"total_borrow_raw" numeric(78, 0) NOT NULL,
	"measured_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "terms_acceptances" (
	"address" text NOT NULL,
	"terms_version" text NOT NULL,
	"signature" text NOT NULL,
	"country" text,
	"accepted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "terms_acceptances_address_terms_version_pk" PRIMARY KEY("address","terms_version")
);
--> statement-breakpoint
CREATE TABLE "vault_events" (
	"name" text NOT NULL,
	"vault" text NOT NULL,
	"user" text NOT NULL,
	"args" jsonb NOT NULL,
	"block_number" bigint NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX "deposits_open" ON "deposits" USING btree ("status","checked_at");--> statement-breakpoint
CREATE INDEX "deposits_user" ON "deposits" USING btree ("user");--> statement-breakpoint
CREATE INDEX "market_rates_market_time" ON "market_rates" USING btree ("market_id","measured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "vault_events_log" ON "vault_events" USING btree ("tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "vault_events_user_order" ON "vault_events" USING btree ("user","block_number","log_index");