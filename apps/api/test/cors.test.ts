import pino from "pino";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { matchesAny, parsePatterns } from "../src/origins";

describe("origin patterns", () => {
  const p = parsePatterns(" https://levra-mon.vercel.app, https://levra-mon-*-team.vercel.app ,http://localhost:3000,");
  it("matches the listed origins and one dash-separated part for a star, nothing else", () => {
    expect(matchesAny(p, "https://levra-mon.vercel.app")).toBe(true);
    expect(matchesAny(p, "https://LEVRA-MON.vercel.app")).toBe(true);
    expect(matchesAny(p, "https://levra-mon-git-main-x1-team.vercel.app")).toBe(true);
    expect(matchesAny(p, "http://localhost:3000")).toBe(true);
    expect(matchesAny(p, "https://levra-mon-x.evil.com-team.vercel.app")).toBe(false);
    expect(matchesAny(p, "https://levra-mon.vercel.app.evil.com")).toBe(false);
    expect(matchesAny(p, "http://localhost:3001")).toBe(false);
    expect(parsePatterns(undefined)).toEqual([]);
  });
});

describe("CORS", () => {
  const app = createApp({ logger: pino({ level: "silent" }), corsOrigins: parsePatterns("https://levra-mon.vercel.app") });
  it("answers a preflight from an allowed origin with the sign-in header allowed, and gives other origins nothing", async () => {
    const ok = await app.request("/v1/health", { method: "OPTIONS", headers: { origin: "https://levra-mon.vercel.app", "access-control-request-method": "PUT", "access-control-request-headers": "authorization,content-type" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://levra-mon.vercel.app");
    expect(ok.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization");
    expect(ok.headers.get("access-control-allow-methods")).toContain("PUT");

    const get = await app.request("/v1/health", { headers: { origin: "https://levra-mon.vercel.app" } });
    expect(get.status).toBe(200);
    expect(get.headers.get("access-control-allow-origin")).toBe("https://levra-mon.vercel.app");

    const other = await app.request("/v1/health", { headers: { origin: "https://evil.example" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});