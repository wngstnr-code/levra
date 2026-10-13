CREATE TABLE "dex_quotes" (
	"run_id" text NOT NULL,
	"kind" text NOT NULL,
	"symbol" text NOT NULL,
	"size_usd_raw" numeric(78, 0) NOT NULL,
	"amount_in" numeric(78, 0) NOT NULL,
	"amount_out" numeric(78, 0),
	"exec_price_e8" numeric(78, 0),
	"mid_price_e8" numeric(78, 0),
	"oracle_price_e8" numeric(78, 0) NOT NULL,
	"price_impact_bps" integer,
	"deviation_bps" integer,
	"error" text,
	"measured_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "dex_quotes_latest" ON "dex_quotes" USING btree ("symbol","kind","measured_at");