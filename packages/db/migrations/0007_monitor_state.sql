CREATE TABLE "monitor_state" (
	"key" text PRIMARY KEY NOT NULL,
	"active" boolean NOT NULL,
	"since" timestamp with time zone,
	"notified" boolean NOT NULL,
	"value" text,
	"message" text,
	"updated_at" timestamp with time zone NOT NULL
);
