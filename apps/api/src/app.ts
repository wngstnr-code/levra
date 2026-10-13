import type { HealthResponse } from "@levra/shared/api";
import { Hono } from "hono";
import { ApiHttpError } from "./errors";
import type { Logger } from "./logger";

export type AppDeps = {
  logger: Logger;
};

export function createApp({ logger }: AppDeps) {
  const app = new Hono();

  app.use(async (c, next) => {
    const started = performance.now();
    await next();
    logger.info(
      { method: c.req.method, path: c.req.path, status: c.res.status, ms: Math.round(performance.now() - started) },
      "request",
    );
  });

  app.get("/v1/health", (c) => c.json({ ok: true } satisfies HealthResponse));

  app.notFound(() => {
    throw new ApiHttpError("NOT_FOUND", "No such endpoint");
  });

  app.onError((err, c) => {
    if (err instanceof ApiHttpError) return c.json(err.toBody(), err.status);
    logger.error({ err }, "unhandled error");
    return c.json(new ApiHttpError("INTERNAL", "Internal error").toBody(), 500);
  });

  return app;
}
