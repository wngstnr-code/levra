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

  it("keeps Monad on the alias routes and puts other chains in the path (D-60)", async () => {
    const { chainScopedPath } = await loadClient("https://api.example.test");
    expect(chainScopedPath("/v1/markets", 143)).toBe("/v1/markets");
    expect(chainScopedPath("/v1/markets", 8453)).toBe("/v1/8453/markets");
    expect(chainScopedPath("/v1/markets/:symbol", 196)).toBe("/v1/196/markets/:symbol");
  });

  it("calls chain scoped endpoints on the chain and global ones without it", async () => {
    const { api } = await loadClient("https://api.example.test");
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => new Response(JSON.stringify(sampleSession), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await api("session", { chainId: 8453 });
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.example.test/v1/8453/session");
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ nonce: "abcdefgh12345678" }), { status: 200 }));
    await api("authNonce", { chainId: 8453 }).catch(() => undefined);
    expect(fetchMock.mock.calls[1]![0]).toBe("https://api.example.test/v1/auth/nonce");
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
