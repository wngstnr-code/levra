CREATE TABLE "prepared_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"kind" text NOT NULL,
	"user" text NOT NULL,
	"request" jsonb NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "prepared_actions_expires" ON "prepared_actions" USING btree ("expires_at");