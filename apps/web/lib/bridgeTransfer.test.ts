import { describe, expect, it } from "vitest";
import { cctpChain, FORWARD_HOOK, MESSAGE_TRANSMITTER_V2, messageTransmitterAbi, TOKEN_MESSENGER_V2, tokenMessengerAbi } from "@levra/cctp";
import { encodeFunctionData, erc20Abi, pad, type Address } from "viem";
import { bridgeDone, checkBridgePlan, checkManualMint, needsApprove } from "./bridgeTransfer";

describe("bridge transfer", () => {
  it("approves only when the allowance is short", () => {
    expect(needsApprove(0n, "1000000")).toBe(true);
    expect(needsApprove(999_999n, "1000000")).toBe(true);
    expect(needsApprove(1_000_000n, "1000000")).toBe(false);
  });
  it("stops polling on complete or failed", () => {
    expect(bridgeDone("COMPLETE")).toBe(true);
    expect(bridgeDone("FAILED")).toBe(true);
    expect(bridgeDone("ATTESTING")).toBe(false);
    expect(bridgeDone(undefined)).toBe(false);
  });
});


const user: Address = "0x00000000000000000000000000000000000000a1";
const evil: Address = "0x00000000000000000000000000000000000000e1";
const from = cctpChain(8453)!;
const to = cctpChain(196)!;
const amount = 5_000_000n;
const fee = 10_000n;

function plan(over: { spender?: Address; recipient?: Address; burnAmount?: bigint; domain?: number; caller?: Address; hook?: `0x${string}` } = {}) {
  return {
    fromChainId: 8453,
    toChainId: 196,
    amountRaw: amount.toString(),
    maxFeeRaw: fee.toString(),
    minReceivedRaw: (amount - fee).toString(),
    finality: "fast" as const,
    estimatedSeconds: 60,
    approve: { to: from.usdc, token: from.usdc, spender: TOKEN_MESSENGER_V2, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [over.spender ?? TOKEN_MESSENGER_V2, amount] }) },
    burn: {
      to: TOKEN_MESSENGER_V2,
      data: encodeFunctionData({
        abi: tokenMessengerAbi,
        functionName: "depositForBurnWithHook",
        args: [over.burnAmount ?? amount, over.domain ?? to.domain, pad(over.recipient ?? user, { size: 32 }), from.usdc, pad(over.caller ?? "0x", { size: 32 }), fee, 1000, over.hook ?? FORWARD_HOOK],
      }),
    },
  };
}
const want = { fromChainId: 8453, toChainId: 196, amountRaw: amount, recipient: user };

describe("checkBridgePlan", () => {
  it("accepts a plan that matches the request", () => {
    expect(() => checkBridgePlan(plan(), want)).not.toThrow();
  });
  it("refuses a burn that mints to someone else", () => {
    expect(() => checkBridgePlan(plan({ recipient: evil }), want)).toThrow(/recipient/);
  });
  it("refuses an approval to another spender", () => {
    expect(() => checkBridgePlan(plan({ spender: evil }), want)).toThrow(/approve/);
  });
  it("refuses a burn only someone else can mint, or without the forwarding hook", () => {
    expect(() => checkBridgePlan(plan({ caller: evil }), want)).toThrow(/hook/);
    expect(() => checkBridgePlan(plan({ hook: "0x" }), want)).toThrow(/hook/);
  });
  it("refuses another amount or destination", () => {
    expect(() => checkBridgePlan(plan({ burnAmount: amount + 1n }), want)).toThrow(/burn/);
    expect(() => checkBridgePlan(plan({ domain: 3 }), want)).toThrow(/burn/);
    expect(() => checkBridgePlan(plan(), { ...want, amountRaw: amount - 1n })).toThrow(/amount/);
  });
});

describe("checkManualMint", () => {
  const data = encodeFunctionData({ abi: messageTransmitterAbi, functionName: "receiveMessage", args: ["0x01", "0x02"] });
  it("accepts Circle's receiveMessage only", () => {
    expect(() => checkManualMint({ to: MESSAGE_TRANSMITTER_V2, data })).not.toThrow();
    expect(() => checkManualMint({ to: evil, data })).toThrow(/mint/);
  });
});
