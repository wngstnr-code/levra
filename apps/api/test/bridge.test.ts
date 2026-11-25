import { FORWARD_HOOK, TOKEN_MESSENGER_V2, cctpChain, tokenMessengerAbi, type IrisFeeQuote, type IrisMessage, type IrisSource } from "@levra/cctp";
import { bridgeChainsResponse, bridgePlan, bridgeStatusResponse, chainRoutes } from "@levra/shared/api";
import pino from "pino";
import { decodeFunctionData, getAddress, pad } from "viem";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { ChainReader } from "../src/chain/reader";

const fees: IrisFeeQuote[] = [
  { finalityThreshold: 1000, minimumFee: 1.3, forwardFee: { low: 50489, med: 50516, high: 50583 } },
  { finalityThreshold: 2000, minimumFee: 0, forwardFee: { low: 50489, med: 50516, high: 50583 } },
];
const user = getAddress("0x00000000000000000000000000000000000b8085");
const burnHash = `0x${"12".repeat(32)}`;
const mintHash = `0x${"34".repeat(32)}`;

function fakeIris() {
  const asked: string[] = [];
  let messages: IrisMessage[] = [];
  const iris: IrisSource = {
    fees: async (from, to) => {
      asked.push(`fees ${from}>${to}`);
      return fees;
    },
    messages: async (domain, hash) => {
      asked.push(`messages ${domain} ${hash}`);
      return messages;
    },
  };
  return { iris, asked, set: (m: IrisMessage[]) => (messages = m) };
}

const reader = (chainId: number) => ({ client: {}, deployment: { chainId, markets: [] } }) as unknown as ChainReader;
const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("CCTP bridge routes (BE-85)", () => {
  const fake = fakeIris();
  const app = createApp({ logger: pino({ level: "silent" }), reader: reader(143), otherChains: [reader(196)], iris: fake.iris });

  it("are chain routes", () => {
    expect(chainRoutes).toEqual(expect.arrayContaining(["bridge/chains", "bridge/deposit", "bridge/withdraw"]));
  });

  it("lists every other CCTP chain for X Layer", async () => {
    const res = await app.request("/v1/196/bridge/chains");
    const { chains } = bridgeChainsResponse.parse(await res.json());
    expect(chains.find((c) => c.chainId === 196)).toBeUndefined();
    expect(chains.find((c) => c.chainId === 8453)).toEqual({ chainId: 8453, name: "Base", domain: 6, usdc: cctpChain(8453)!.usdc, fast: true });
  });

  it("plans a deposit from Base into X Layer that the wallet signs on Base", async () => {
    const res = await app.request("/v1/196/bridge/deposit", json({ fromChainId: 8453, amountRaw: "100000000", recipient: user }));
    expect(res.status).toBe(200);
    const plan = bridgePlan.parse(await res.json());
    expect(plan).toMatchObject({ fromChainId: 8453, toChainId: 196, amountRaw: "100000000", maxFeeRaw: "66183", minReceivedRaw: "99933817", finality: "fast" });
    expect(plan.approve).toMatchObject({ to: cctpChain(8453)!.usdc, spender: TOKEN_MESSENGER_V2 });
    const burn = decodeFunctionData({ abi: tokenMessengerAbi, data: plan.burn.data });
    expect(burn.args.slice(1, 3)).toEqual([37, pad(user, { size: 32 })]);
    expect(burn.args[7]).toBe(FORWARD_HOOK);
    expect(fake.asked).toContain("fees 6>37");
  });

  it("plans a withdrawal from X Layer to the recipient on Arbitrum", async () => {
    const recipient = getAddress("0x00000000000000000000000000000000000a4b1e");
    const res = await app.request("/v1/196/bridge/withdraw", json({ toChainId: 42161, amountRaw: "2500000", user, recipient }));
    const plan = bridgePlan.parse(await res.json());
    expect(plan).toMatchObject({ fromChainId: 196, toChainId: 42161 });
    expect(plan.approve.to).toBe(cctpChain(196)!.usdc);
    expect(decodeFunctionData({ abi: tokenMessengerAbi, data: plan.burn.data }).args.slice(1, 3)).toEqual([3, pad(recipient, { size: 32 }).toLowerCase()]);
  });

  it("refuses an unknown or same chain, a tiny amount and a bad body", async () => {
    const codes = async (path: string, body: unknown) => {
      const res = await app.request(path, json(body));
      return [res.status, ((await res.json()) as { error: { code: string } }).error.code];
    };
    expect(await codes("/v1/196/bridge/deposit", { fromChainId: 196, amountRaw: "5000000", recipient: user })).toEqual([400, "BAD_REQUEST"]);
    expect(await codes("/v1/196/bridge/deposit", { fromChainId: 56, amountRaw: "5000000", recipient: user })).toEqual([400, "BAD_REQUEST"]);
    expect(await codes("/v1/196/bridge/deposit", { fromChainId: 8453, amountRaw: "999999", recipient: user })).toEqual([400, "BAD_REQUEST"]);
    expect(await codes("/v1/196/bridge/deposit", { fromChainId: 8453, amountRaw: "-1", recipient: user })).toEqual([400, "BAD_REQUEST"]);
    expect(await codes("/v1/196/bridge/withdraw", { toChainId: 8453, amountRaw: "5000000", user })).toEqual([400, "BAD_REQUEST"]);
  });

  it("plans a deposit on a chain route when the rate limit has read the body", async () => {
    const limited = createApp({ logger: pino({ level: "silent" }), reader: reader(143), otherChains: [reader(196)], iris: fake.iris, rateLimit: {} });
    const res = await limited.request("/v1/196/bridge/deposit", json({ fromChainId: 8453, amountRaw: "100000000", recipient: user }));
    expect(res.status).toBe(200);
    expect(bridgePlan.parse(await res.json())).toMatchObject({ fromChainId: 8453, toChainId: 196 });
    const bad = await limited.request("/v1/196/bridge/deposit", { ...json({}), body: "not json" });
    expect(bad.status).toBe(400);
  });

  it("answers 404 on a chain that is not live", async () => {
    expect((await app.request("/v1/8453/bridge/chains")).status).toBe(404);
  });

  it("follows a burn until the Forwarding Service minted it", async () => {
    const status = async () => bridgeStatusResponse.parse(await (await app.request(`/v1/bridge/status?fromChainId=8453&txHash=${burnHash}`)).json());
    fake.set([]);
    expect((await status()).state).toBe("NOT_FOUND");

    const later = createApp({ logger: pino({ level: "silent" }), reader: reader(143), iris: fake.iris });
    fake.set([
      {
        message: "0x00000001",
        attestation: "0xaa",
        status: "complete",
        forwardState: "COMPLETE",
        forwardTxHash: mintHash,
        decodedMessage: { sourceDomain: "6", destinationDomain: "37", decodedMessageBody: { amount: "100000000", feeExecuted: "63500" } },
      },
    ]);
    const s = bridgeStatusResponse.parse(await (await later.request(`/v1/bridge/status?fromChainId=8453&txHash=${burnHash}`)).json());
    expect(s).toMatchObject({ state: "COMPLETE", toChainId: 196, amountRaw: "100000000", feeRaw: "63500", receivedRaw: "99936500", mintTxHash: mintHash, manualMint: null });
  });

  it("refuses a status without a valid hash or for an unknown chain", async () => {
    expect((await app.request("/v1/bridge/status?fromChainId=8453&txHash=0x12")).status).toBe(400);
    expect((await app.request(`/v1/bridge/status?fromChainId=56&txHash=${burnHash}`)).status).toBe(400);
  });
});
