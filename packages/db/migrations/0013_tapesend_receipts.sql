CREATE TABLE "receipt_keys" (
	"address" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"key_index" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tapesend_outbox" (
	"address" text NOT NULL,
	"key" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"levra" jsonb NOT NULL,
	"event_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"public_key" text,
	"payload" text,
	"tx_hash" text,
	"tx_sent_at" timestamp with time zone,
	"inbox_index" numeric(78, 0),
	"sent_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	CONSTRAINT "tapesend_outbox_address_key_pk" PRIMARY KEY("address","key")
);
--> statement-breakpoint
CREATE INDEX "tapesend_outbox_waiting" ON "tapesend_outbox" USING btree ("created_at") WHERE "tapesend_outbox"."sent_at" is null;