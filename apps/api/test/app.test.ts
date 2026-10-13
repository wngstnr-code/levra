import { apiError, healthResponse } from "@levra/shared/api";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";

const app = createApp({ logger: pino({ level: "silent" }) });

describe("api", () => {
  it("answers health", async () => {
    const res = await app.request("/v1/health");
    expect(res.status).toBe(200);
    expect(healthResponse.parse(await res.json())).toEqual({ ok: true });
  });

  it("returns the shared error shape for an unknown path", async () => {
    const res = await app.request("/v1/nope");
    expect(res.status).toBe(404);
    expect(apiError.parse(await res.json()).error.code).toBe("NOT_FOUND");
  });
});
