import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const keeperHeartbeats = pgTable("keeper_heartbeats", {
  name: text("name").primaryKey(),
  lastBeatAt: timestamp("last_beat_at", { withTimezone: true }).notNull(),
  lastError: text("last_error"),
  details: jsonb("details"),
});
