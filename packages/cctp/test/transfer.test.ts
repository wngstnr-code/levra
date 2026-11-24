import { tokensByChain } from "@levra/shared/addresses";
import { decodeFunctionData, erc20Abi, pad } from "viem";
import { describe, expect, it } from "vitest";
import {
  FORWARD_HOOK,
  MESSAGE_TRANSMITTER_V2,
  TOKEN_MESSENGER_V2,
  TransferError,
  cctpChain,
  cctpChains,
  createIris,
  maxFeeFor,
  messageTransmitterAbi,
  planBurn,
  readTransfer,
  tokenMessengerAbi,
  type IrisFeeQuote,
  type IrisMessage,
} from "../src";

// Shapes as Iris answered on 24 November 2026 for Base to X Layer (6 to 37).
const baseToXlayer: IrisFeeQuote[] = [
  { finalityThreshold: 1000, minimumFee: 1.3, forwardFee: { low: 50489, med: 50516, high: 50583 } },
  { finalityThreshold: 2000, minimumFee: 0, forwardFee: { low: 50489, med: 50516, high: 50583 } },
];
const base = cctpChain(8453)!;
const xlayer = cctpChain(196)!;
const monad = cctpChain(143)!;
const user = "0x1111111111111111111111111111111111111111" as const;

describe("CCTP chains", () => {
  it("has one row per chain and per domain, and the Levra chains' USDC from packages/shared", () => {
    expect(new Set(cctpChains.map((c) => c.chainId)).size).toBe(cctpChains.length);
    expect(new Set(cctpChains.map((c) => c.domain)).size).toBe(cctpChains.length);
    for (const id of [143, 8453, 196] as const) expect(cctpChain(id)!.usdc).toBe(tokensByChain[id].USDC.address);
    expect(xlayer.domain).toBe(37);
  });
});

describe("maxFeeFor", () => {
  it("rounds Circle's percentage up, adds 20% and the high forwarding fee", () => {
    // 100 USDC at 1.3 bps is 13,000 units; plus 20% is 15,600; plus 50,583.
    expect(maxFeeFor(100_000_000n, baseToXlayer[0]!)).toBe(66_183n);
    // 1 unit at 1.3 bps rounds up to 1, plus 20% rounds up to 2.
    expect(maxFeeFor(1n, baseToXlayer[0]!)).toBe(50_585n);
    expect(maxFeeFor(100_000_000n, baseToXlayer[1]!)).toBe(50_583n);
  });
});

describe("planBurn", () => {
  it("builds the approve and a fast forwarded burn to the recipient", () => {
    const plan = planBurn({ from: base, to: xlayer, amount: 100_000_000n, recipient: user, fees: baseToXlayer });
    expect(plan.finality).toBe("fast");
    expect(plan.maxFee).toBe(66_183n);
    expect(plan.minReceived).toBe(100_000_000n - 66_183n);
    expect(plan.approve).toMatchObject({ to: base.usdc, token: base.usdc, spender: TOKEN_MESSENGER_V2 });
    expect(decodeFunctionData({ abi: erc20Abi, data: plan.approve.data }).args).toEqual([TOKEN_MESSENGER_V2, 100_000_000n]);
    expect(plan.burn.to).toBe(TOKEN_MESSENGER_V2);
    const burn = decodeFunctionData({ abi: tokenMessengerAbi, data: plan.burn.data });
    expect(burn.args).toEqual([100_000_000n, 37, pad(user, { size: 32 }), base.usdc, pad("0x", { size: 32 }), 66_183n, 1000, FORWARD_HOOK]);
  });

  it("uses a standard burn where Circle has no Fast Transfer from the source", () => {
    const fees = baseToXlayer.map((q) => ({ ...q }));
    const plan = planBurn({ from: monad, to: xlayer, amount: 5_000_000n, recipient: user, fees });
    expect(plan.finality).toBe("standard");
    expect(plan.maxFee).toBe(50_583n);
    expect(decodeFunctionData({ abi: tokenMessengerAbi, data: plan.burn.data }).args[6]).toBe(2000);
  });

  it("refuses a transfer to the same chain, below 1 USDC, without forwarding or below the fee", () => {
    expect(() => planBurn({ from: xlayer, to: xlayer, amount: 5_000_000n, recipient: user, fees: baseToXlayer })).toThrow(TransferError);
    expect(() => planBurn({ from: base, to: xlayer, amount: 999_999n, recipient: user, fees: baseToXlayer })).toThrow(/smallest/);
    expect(() => planBurn({ from: base, to: xlayer, amount: 5_000_000n, recipient: user, fees: [{ finalityThreshold: 1000, minimumFee: 1, forwardFee: null }] })).toThrow(/forward/);
    expect(() => planBurn({ from: base, to: xlayer, amount: 5_000_000n, recipient: user, fees: [] })).toThrow(/no fee/);
    const dear: IrisFeeQuote[] = [{ finalityThreshold: 1000, minimumFee: 1, forwardFee: { low: 2_000_000, med: 2_000_000, high: 2_000_000 } }];
    expect(() => planBurn({ from: base, to: xlayer, amount: 1_500_000n, recipient: user, fees: dear })).toThrow(/does not cover/);
  });
});

const attested: IrisMessage = {
  message: "0x0000000101",
  attestation: "0xabcdef",
  status: "complete",
  decodedMessage: { sourceDomain: "6", destinationDomain: "37", decodedMessageBody: { amount: "100000000", feeExecuted: "63000" } },
};
const mintHash = `0x${"ab".repeat(32)}`;

describe("readTransfer", () => {
  it("follows a burn from unseen to minted", () => {
    expect(readTransfer([]).state).toBe("NOT_FOUND");
    expect(readTransfer([{ ...attested, status: "pending_confirmations", attestation: "PENDING", message: "0x" }])).toMatchObject({ state: "ATTESTING", toChainId: 196, amount: 100_000_000n });
    expect(readTransfer([{ ...attested, delayReason: "insufficient_fee", status: "pending_confirmations", attestation: "PENDING" }]).delayReason).toBe("insufficient_fee");
    expect(readTransfer([{ ...attested, forwardState: "PENDING" }]).state).toBe("MINTING");
    expect(readTransfer([{ ...attested, forwardState: "COMPLETE", forwardTxHash: mintHash }])).toMatchObject({ state: "COMPLETE", mintTxHash: mintHash, fee: 63_000n, manualMint: null });
  });

  it("gives the receiveMessage call when forwarding failed, so the USDC can still be minted", () => {
    const s = readTransfer([{ ...attested, forwardState: "FAILED" }]);
    expect(s.state).toBe("FAILED");
    expect(s.manualMint?.to).toBe(MESSAGE_TRANSMITTER_V2);
    expect(decodeFunctionData({ abi: messageTransmitterAbi, data: s.manualMint!.data }).args).toEqual([attested.message, attested.attestation]);
  });
});

describe("Iris client", () => {
  const answer = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

  it("reads fees and messages, and an unseen burn as no messages", async () => {
    const calls: string[] = [];
    const iris = createIris({
      baseUrl: "https://iris.test",
      fetchFn: (async (url: string) => {
        calls.push(url);
        if (url.includes("/fees/")) return answer(200, baseToXlayer)();
        if (url.includes("0xunseen")) return answer(404, { message: "Message not found" })();
        return answer(200, { messages: [attested] })();
      }) as typeof fetch,
    });
    expect(await iris.fees(6, 37)).toEqual(baseToXlayer);
    expect(await iris.messages(6, "0xabc")).toHaveLength(1);
    expect(await iris.messages(6, "0xunseen")).toEqual([]);
    expect(calls[0]).toBe("https://iris.test/v2/burn/USDC/fees/6/37?forward=true");
    expect(calls[1]).toBe("https://iris.test/v2/messages/6?transactionHash=0xabc");
  });

  it("maps a busy, refusing or broken service to its error code", async () => {
    const with_ = (status: number, body: unknown) => createIris({ baseUrl: "https://iris.test", fetchFn: answer(status, body) as typeof fetch });
    await expect(with_(429, {}).fees(6, 37)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(with_(400, {}).fees(6, 37)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(with_(500, {}).fees(6, 37)).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
    await expect(with_(200, { nope: 1 }).fees(6, 37)).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
  });
});
