import { createDb, keeperHeartbeats, runMigrations } from "@levra/db";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runJob, type Job } from "../src/runner";

const url = process.env.TEST_DATABASE_URL;
const logger = pino({ level: "silent" });

describe.skipIf(!url)("runner (needs TEST_DATABASE_URL)", () => {
  const { db, close } = createDb(url ?? "", { max: 2 });

  beforeAll(async () => {
    await runMigrations(url ?? "");
    await db.delete(keeperHeartbeats);
  });
  afterAll(() => close());

  async function runOnce(job: Omit<Job, "intervalMs">) {
    const controller = new AbortController();
    const wrapped: Job = {
      ...job,
      intervalMs: 60_000,
      async run(ctx) {
        try {
          return await job.run(ctx);
        } finally {
          controller.abort();
        }
      },
    };
    await runJob(wrapped, { db, logger, signal: controller.signal });
    const [row] = await db.select().from(keeperHeartbeats).where(eq(keeperHeartbeats.name, job.name));
    return row;
  }

  it("records a heartbeat with details after a good run", async () => {
    const row = await runOnce({ name: "oracleMonitor", run: async () => ({ reads: 3 }) });
    expect(row?.lastError).toBeNull();
    expect(row?.details).toEqual({ reads: 3 });
  });

  it("records the error and keeps going after a failed run", async () => {
    const row = await runOnce({
      name: "calendar",
      run: async () => {
        throw new Error("rpc down");
      },
    });
    expect(row?.lastError).toBe("rpc down");
  });
});
