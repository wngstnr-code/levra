import { AcrossError, type AcrossQuote, type AcrossQuoteRequest, type AcrossSource, type AcrossTransfer } from "@levra/across";
import { tokensByChain } from "@levra/shared/addresses";
import { acrossDepositPlan, acrossStatusResponse, chainRoutes } from "@levra/shared/api";
import pino from "pino";
import { decodeFunctionData, erc20Abi, getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { ChainReader } from "../src/chain/reader";

const user = getAddress("0x00000000000000000000000000000000000b8085");
const ARB_USDT = getAddress("0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9");
const SPOKE = getAddress("0x998d7c178A1F9607b47eA3A8e22426451b3ce707");
const BASE_USDC = tokensByChain[8453].USDC.address;

/** Answers with an approval-funded quote that echoes the request, unless `edit` changes it. */
function fakeAcross(edit: (q: AcrossQuote) => AcrossQuote = (q) => q) {
  const asked: AcrossQuoteRequest[] = [];
  let transfer: AcrossTransfer | null = null;
  let fail: AcrossError | null = null;
  const across: AcrossSource = {
    quote: async (req) => {
      asked.push(req);
      if (fail) throw fail;
      return edit({
        orderId: `0x${"ab".repeat(32)}`,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        expectedFillTimeMs: 2_000,
        origin: { token: { chainId: req.originChainId, address: req.inputToken }, amount: req.amountRaw.toString(), depositor: { address: req.depositor } },
        destination: { token: { chainId: req.destinationChainId, address: req.outputToken }, amount: "9979842", minAmount: "9921185", recipient: { address: req.recipient } },
        fee: { totalFee: { amount: "20158" } },
        nextActions: [
          { kind: "approve_token", tokenAddress: req.inputToken, spender: SPOKE, amount: req.amountRaw.toString() },
          { kind: "send_transaction", id: "prefunded-store", to: SPOKE, data: "0x110560ad00", value: "0" },
        ],
      } as AcrossQuote);
    },
    transfer: async () => transfer,
  };
  return { across, asked, setTransfer: (t: AcrossTransfer | null) => (transfer = t), setFail: (e: AcrossError | null) => (fail = e) };
}

const reader = (chainId: number) => ({ client: {}, deployment: { chainId, markets: [] } }) as unknown as ChainReader;
const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const deposit = { fromChainId: 42161, inputToken: ARB_USDT, amountRaw: "10000000", depositor: user, recipient: user };

describe("Across deposit routes (BE-76)", () => {
  it("is a chain route", () => {
    expect(chainRoutes).toContain("bridge/across/deposit");
  });

  it("plans a USDT deposit from Arbitrum into USDC on Base: approve, then the deposit", async () => {
    const fake = fakeAcross();
    const app = createApp({ logger: pino({ level: "silent" }), reader: reader(143), otherChains: [reader(8453)], across: fake.across });
    const res = await app.request("/v1/8453/bridge/across/deposit", json(deposit));
    expect(res.status).toBe(200);
    const plan = acrossDepositPlan.parse(await res.json());
    expect(plan).toMatchObject({ fromChainId: 42161, toChainId: 8453, inputToken: ARB_USDT, amountRaw: "10000000", expectedReceivedRaw: "9979842", minReceivedRaw: "9921185", feeRaw: "20158", estimatedSeconds: 2 });
    expect(plan.approve).toMatchObject({ to: ARB_USDT, token: ARB_USDT, spender: SPOKE });
    expect(decodeFunctionData({ abi: erc20Abi, data: plan.approve!.data }).args).toEqual([SPOKE, 10_000_000n]);
    expect(plan.deposit).toEqual({ to: SPOKE, data: "0x110560ad00", valueRaw: "0" });
    expect(fake.asked[0]).toMatchObject({ destinationChainId: 8453, outputToken: BASE_USDC, recipient: user, amountRaw: 10_000_000n });
  });

  it("serves Monad without a chain ID, and not X Layer, which Across does not list", async () => {
    const fake = fakeAcross();
    const app = createApp({ logger: pino({ level: "silent" }), reader: reader(143), otherChains: [reader(196)], across: fake.across });
    expect((await app.request("/v1/bridge/across/deposit", json(deposit))).status).toBe(200);
    expect(fake.asked[0]?.outputToken).toBe(tokensByChain[143].USDC.address);
    expect((await app.request("/v1/196/bridge/across/deposit", json(deposit))).status).toBe(404);
  });

  it("refuses bad requests, a deposit from the same chain, and a quote that changed the recipient", async () => {
    const app = createApp({ logger: pino({ level: "silent" }), reader: reader(143), otherChains: [reader(8453)], across: fakeAcross().across });
    expect((await app.request("/v1/8453/bridge/across/deposit", json({ ...deposit, amountRaw: "0" }))).status).toBe(400);
    expect((await app.request("/v1/8453/bridge/across/deposit", json({ ...deposit, fromChainId: 8453 }))).status).toBe(400);
    const changed = fakeAcross((q) => ({ ...q, destination: { ...q.destination, recipient: { address: SPOKE } } }));
    const app2 = createApp({ logger: pino({ level: "silent" }), reader: reader(143), otherChains: [reader(8453)], across: changed.across });
    const res = await app2.request("/v1/8453/bridge/across/deposit", json(deposit));
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).toMatch(/another recipient/);
  });

  it("passes on Across's refusals with their codes", async () => {
    const fake = fakeAcross();
    const app = createApp({ logger: pino({ level: "silent" }), reader: reader(143), otherChains: [reader(8453)], across: fake.across });
    fake.setFail(new AcrossError("BAD_REQUEST", "Across refused the transfer: below the minimum"));
    expect((await app.request("/v1/8453/bridge/across/deposit", json(deposit))).status).toBe(400);
    fake.setFail(new AcrossError("RATE_LIMITED", "busy"));
    expect((await app.request("/v1/8453/bridge/across/deposit", json(deposit))).status).toBe(429);
  });

  it("reports an order: not_found until Across sees it, then its state and the two transactions", async () => {
    const fake = fakeAcross();
    const app = createApp({ logger: pino({ level: "silent" }), reader: reader(143), across: fake.across });
    const orderId = `0x${"ab".repeat(32)}`;
    const first = acrossStatusResponse.parse(await (await app.request(`/v1/bridge/across/status?orderId=${orderId}`)).json());
    expect(first).toMatchObject({ state: "not_found", terminal: false });
    fake.setTransfer({
      status: { state: "completed", reason: "filled", description: "The transfer is complete.", isTerminal: true },
      output: { amount: "9979842" },
      transactions: [
        { type: "deposit", transaction: { txnRef: `0x${"12".repeat(32)}`, chainId: 42161 } },
        { type: "fill", transaction: { txnRef: `0x${"34".repeat(32)}`, chainId: 8453 } },
      ],
    } as AcrossTransfer);
    const done = acrossStatusResponse.parse(await (await app.request(`/v1/bridge/across/status?orderId=${orderId}`)).json());
    expect(done).toEqual({ orderId, state: "completed", terminal: true, description: "The transfer is complete.", depositTxHash: `0x${"12".repeat(32)}`, fillTxHash: `0x${"34".repeat(32)}`, receivedRaw: "9979842" });
    expect((await app.request("/v1/bridge/across/status?orderId=a/b")).status).toBe(400);
  });

  it("is off without an Across source", async () => {
    const app = createApp({ logger: pino({ level: "silent" }), reader: reader(143) });
    expect((await app.request("/v1/bridge/across/deposit", json(deposit))).status).toBe(404);
    expect((await app.request("/v1/bridge/across/status?orderId=0xab")).status).toBe(404);
  });
});
