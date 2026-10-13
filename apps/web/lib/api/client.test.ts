import { afterEach, describe, expect, it, vi } from "vitest";

const sampleSession = { session: "PRE_MARKET", closedRegime: false, nextCloseAt: 1791921600, nextOpenAt: null, updatedAt: 1791880000 };

async function loadClient(url: string | undefined) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_API_URL", url ?? "");
  return import("./client");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("api client", () => {
  it("refuses to call when the service is not configured", async () => {
    const { api, ApiUnavailableError } = await loadClient(undefined);
    await expect(api("session")).rejects.toBeInstanceOf(ApiUnavailableError);
  });

  it("fills path parameters and the query", async () => {
    const { endpointUrl } = await loadClient("https://api.example.test/");
    expect(endpointUrl("/v1/accounts/:address/history", { address: "0xabc" }, { limit: 20, cursor: undefined })).toBe(
      "https://api.example.test/v1/accounts/0xabc/history?limit=20",
    );
  });

  it("validates the answer against the shared schema", async () => {
    const { api } = await loadClient("https://api.example.test");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(sampleSession), { status: 200 })));
    await expect(api("session")).resolves.toEqual(sampleSession);
  });

  it("rejects an answer with the wrong shape", async () => {
    const { api } = await loadClient("https://api.example.test");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ session: "LUNCH" }), { status: 200 })));
    await expect(api("session")).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });

  it("passes on the error code from the service", async () => {
    const { api } = await loadClient("https://api.example.test");
    const body = { error: { code: "INSUFFICIENT_LIQUIDITY", message: "Not enough USDC to borrow." } };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 409 })));
    await expect(api("session")).rejects.toMatchObject({ code: "INSUFFICIENT_LIQUIDITY", status: 409 });
  });

  it("reports a network failure as NETWORK", async () => {
    const { api } = await loadClient("https://api.example.test");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(api("session")).rejects.toMatchObject({ code: "NETWORK" });
  });
});
