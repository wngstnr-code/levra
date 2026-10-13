CREATE TABLE "keeper_heartbeats" (
	"name" text PRIMARY KEY NOT NULL,
	"last_beat_at" timestamp with time zone NOT NULL,
	"last_error" text,
	"details" jsonb
);
