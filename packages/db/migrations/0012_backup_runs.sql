CREATE TABLE "backup_runs" (
	"kind" text NOT NULL,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ok" boolean NOT NULL,
	"error" text,
	"details" jsonb,
	CONSTRAINT "backup_runs_kind_finished_at_pk" PRIMARY KEY("kind","finished_at")
);
