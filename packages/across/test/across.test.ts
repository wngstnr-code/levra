import { describe, expect, it } from "vitest";
import { AcrossError, createAcross, planDeposit, type AcrossQuote, type AcrossQuoteRequest } from "../src";

const USER = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ARB_USDT = "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9";
const SPENDER = "0x998d7c178A1F9607b47eA3A8e22426451b3ce707";
const NOW = Date.parse("2026-11-27T10:00:00Z");

const req: AcrossQuoteRequest = { originChainId: 42161, inputToken: ARB_USDT, amountRaw: 10_000_000n, depositor: USER, destinationChainId: 8453, outputToken: BASE_USDC, recipient: USER };

/** An approval-funded quote in the shape of Across's docs (fields we do not read left out). */
const quote = (over: Partial<AcrossQuote> = {}): AcrossQuote =>
  ({
    orderId: "0x7a961202c77345e711eb85ec722687848327dc26bd81f6e8b09c3dd7489044f4",
    expiresAt: "2026-11-27T10:15:00.000Z",
    expectedFillTimeMs: 1252,
    origin: { token: { chainId: 42161, address: ARB_USDT.toLowerCase() }, amount: "10000000", depositor: { address: USER } },
    destination: { token: { chainId: 8453, address: BASE_USDC.toLowerCase() }, amount: "9979842", minAmount: "9921185", recipient: { address: USER } },
    fee: { totalFee: { amount: "20158" } },
    nextActions: [
      { kind: "approve_token", tokenAddress: ARB_USDT, spender: SPENDER, amount: "10000000", chainId: 42161 },
      { kind: "send_transaction", id: "prefunded-store", to: SPENDER, data: "0x110560ad00", value: "0", chainId: 42161 },
    ],
    ...over,
  }) as AcrossQuote;

describe("planDeposit (BE-76)", () => {
  it("turns an approval-funded quote into an approve and a deposit for the wallet", () => {
    expect(planDeposit(req, quote(), NOW)).toEqual({
      orderId: quote().orderId,
      expiresAtMs: Date.parse("2026-11-27T10:15:00.000Z"),
      estimatedSeconds: 2,
      amountRaw: 10_000_000n,
      expectedReceivedRaw: 9_979_842n,
      minReceivedRaw: 9_921_185n,
      feeRaw: 20_158n,
      approve: { token: ARB_USDT, spender: SPENDER, amountRaw: 10_000_000n },
      deposit: { to: SPENDER, data: "0x110560ad00", valueRaw: 0n },
    });
  });

  it("has no approve when the allowance already covers the amount, and sends the value for a native deposit", () => {
    const deposit = quote().nextActions[1]!;
    expect(planDeposit(req, quote({ nextActions: [deposit] }), NOW).approve).toBeNull();
    const eth = { ...req, inputToken: "0x0000000000000000000000000000000000000000" };
    const ethQuote = quote({
      origin: { token: { chainId: 42161, address: eth.inputToken }, amount: "10000000", depositor: { address: USER } },
      nextActions: [{ ...deposit, value: "10000000" }],
    } as Partial<AcrossQuote>);
    expect(planDeposit(eth, ethQuote, NOW).deposit.valueRaw).toBe(10_000_000n);
    expect(() => planDeposit(eth, quote({ ...ethQuote, nextActions: [{ ...deposit, value: "0" }] } as Partial<AcrossQuote>), NOW)).toThrow(/native value/);
  });

  it("refuses a quote that changed what was asked", () => {
    const q = quote();
    expect(() => planDeposit({ ...req, recipient: OTHER }, q, NOW)).toThrow(/another recipient/);
    expect(() => planDeposit({ ...req, depositor: OTHER }, q, NOW)).toThrow(/another depositor/);
    expect(() => planDeposit({ ...req, amountRaw: 9_000_000n }, q, NOW)).toThrow(/another input amount/);
    expect(() => planDeposit({ ...req, outputToken: OTHER }, q, NOW)).toThrow(/another output token/);
    expect(() => planDeposit({ ...req, originChainId: 10 }, q, NOW)).toThrow(/another input token/);
    expect(() => planDeposit(req, quote({ destination: { ...q.destination, minAmount: "0" } }), NOW)).toThrow(/no guaranteed amount/);
    expect(() => planDeposit(req, q, Date.parse("2026-11-27T10:15:00.000Z"))).toThrow(/expired/);
  });

  it("refuses steps a plain wallet should not run", () => {
    const [approve, deposit] = quote().nextActions as unknown as [Record<string, unknown>, Record<string, unknown>];
    const withActions = (nextActions: unknown[]) => quote({ nextActions } as Partial<AcrossQuote>);
    expect(() => planDeposit(req, withActions([{ kind: "sign_typed_data", id: "funding" }, { kind: "submit_execution", id: "x" }]), NOW)).toThrow(/sign_typed_data/);
    expect(() => planDeposit(req, withActions([{ ...approve, tokenAddress: OTHER }, deposit]), NOW)).toThrow(/another token/);
    expect(() => planDeposit(req, withActions([{ ...approve, amount: "115792089237316195423570985008687907853269984665640564039457584007913129639935" }, deposit]), NOW)).toThrow(/another amount/);
    expect(() => planDeposit(req, withActions([approve, { ...deposit, chainId: 8453 }]), NOW)).toThrow(/another chain/);
    expect(() => planDeposit(req, withActions([approve, { ...deposit, value: "1" }]), NOW)).toThrow(/native value/);
    expect(() => planDeposit(req, withActions([approve, { ...deposit, id: "other" }]), NOW)).toThrow(/does not run/);
    expect(() => planDeposit(req, withActions([deposit, approve]), NOW)).toThrow(/does not run/);
    expect(() => planDeposit(req, withActions([approve]), NOW)).toThrow(/no deposit/);
  });
});

describe("createAcross (BE-76)", () => {
  const answer = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("sends the key and an approval-only quote request, and reads the quote", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const across = createAcross({
      apiKey: "test-key",
      fetchFn: (async (url: string, init: RequestInit) => {
        seen = { url, init };
        return answer(200, quote())();
      }) as typeof fetch,
    });
    expect((await across.quote(req)).orderId).toBe(quote().orderId);
    expect(seen?.url).toBe("https://api.across.to/v1/quotes");
    expect((seen?.init.headers as Record<string, string>).authorization).toBe("Bearer test-key");
    const body = JSON.parse(String(seen?.init.body));
    expect(body).toMatchObject({ amountType: "exact_input", authorizationPolicy: { allowedTypes: ["approval"] }, origin: { amount: "10000000", depositor: USER } });
  });

  it("maps Across's refusals: a refused amount is the caller's, a refused key or an outage is ours", async () => {
    const policy = createAcross({ apiKey: "k", fetchFn: answer(400, { error: { code: "policy.amount_out_of_range", message: "below the minimum" } }) as unknown as typeof fetch });
    await expect(policy.quote(req)).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/below the minimum/) });
    const key = createAcross({ apiKey: "k", fetchFn: answer(401, { code: "unauthenticated", message: "AUTH_INVALID" }) as unknown as typeof fetch });
    await expect(key.quote(req)).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
    const busy = createAcross({ apiKey: "k", fetchFn: answer(429, { code: "rate_limited" }) as unknown as typeof fetch });
    await expect(busy.quote(req)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    const down = createAcross({ apiKey: "k", fetchFn: (async () => Promise.reject(new Error("offline"))) as typeof fetch });
    await expect(down.quote(req)).rejects.toBeInstanceOf(AcrossError);
    const odd = createAcross({ apiKey: "k", fetchFn: answer(200, { orderId: 1 }) as unknown as typeof fetch });
    await expect(odd.quote(req)).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
  });

  it("reads a transfer, and null while Across has not seen the deposit", async () => {
    const done = {
      status: { state: "completed", reason: "filled", description: "The transfer is complete.", isTerminal: true },
      output: { amount: "9979842" },
      transactions: [
        { type: "deposit", transaction: { txnRef: "0x17", chainId: 42161 } },
        { type: "fill", transaction: { txnRef: "0xdc", chainId: 8453 } },
      ],
    };
    expect((await createAcross({ apiKey: "k", fetchFn: answer(200, done) as unknown as typeof fetch }).transfer("0xabc"))?.status.state).toBe("completed");
    expect(await createAcross({ apiKey: "k", fetchFn: answer(404, { error: { code: "not_found.transfer" } }) as unknown as typeof fetch }).transfer("0xabc")).toBeNull();
  });
});
