import { encodeFunctionData, erc20Abi, pad, type Address, type Hex } from "viem";
import { FAST_FINALITY, MESSAGE_TRANSMITTER_V2, STANDARD_FINALITY, TOKEN_MESSENGER_V2, cctpChainByDomain, type CctpChain } from "./chains";
import type { IrisFeeQuote, IrisMessage } from "./iris";

/** Forwarding Service hook: "cctp-forward" in 24 bytes, version 0, no extra data. Circle mints on the destination. */
export const FORWARD_HOOK: Hex = "0x636374702d666f72776172640000000000000000000000000000000000000000";

/** Initial proposals: the smallest transfer, and the margin on Circle's percentage fee in case it rises before the burn. */
export const MIN_TRANSFER_RAW = 1_000_000n;
export const FEE_MARGIN_BPS = 2_000n;

export const tokenMessengerAbi = [
  {
    type: "function",
    name: "depositForBurnWithHook",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

export const messageTransmitterAbi = [
  {
    type: "function",
    name: "receiveMessage",
    stateMutability: "nonpayable",
    inputs: [
      { name: "message", type: "bytes" },
      { name: "attestation", type: "bytes" },
    ],
    outputs: [{ name: "success", type: "bool" }],
  },
] as const;

export type Call = { to: Address; data: Hex };

export type BurnPlan = {
  from: CctpChain;
  to: CctpChain;
  amount: bigint;
  maxFee: bigint;
  /** What arrives if the whole `maxFee` is charged; usually a little more arrives. */
  minReceived: bigint;
  finality: "fast" | "standard";
  /** Approve the messenger for `amount` of USDC on the source chain, unless the allowance already covers it. */
  approve: Call & { token: Address; spender: Address };
  burn: Call;
};

export class TransferError extends Error {}

/** Circle's percentage fee, rounded up, plus the margin, plus the forwarding fee at its high estimate. */
export function maxFeeFor(amount: bigint, quote: IrisFeeQuote): bigint {
  const centiBps = BigInt(Math.round(quote.minimumFee * 100));
  const protocol = ceilDiv(amount * centiBps, 1_000_000n);
  const withMargin = ceilDiv(protocol * (10_000n + FEE_MARGIN_BPS), 10_000n);
  return withMargin + BigInt(quote.forwardFee?.high ?? 0);
}

/** One `depositForBurnWithHook` from `from` to `to`, minted to `recipient` by the Forwarding Service. */
export function planBurn({ from, to, amount, recipient, fees }: { from: CctpChain; to: CctpChain; amount: bigint; recipient: Address; fees: IrisFeeQuote[] }): BurnPlan {
  if (from.chainId === to.chainId) throw new TransferError("The source and destination chain are the same.");
  if (amount < MIN_TRANSFER_RAW) throw new TransferError(`The smallest transfer is ${formatUsdc(MIN_TRANSFER_RAW)} USDC.`);
  const wanted = from.fastSource ? FAST_FINALITY : STANDARD_FINALITY;
  const quote = fees.find((q) => q.finalityThreshold === wanted) ?? fees.find((q) => q.finalityThreshold === STANDARD_FINALITY);
  if (!quote) throw new TransferError("Circle gave no fee for this route.");
  if (!quote.forwardFee) throw new TransferError("Circle does not forward to this chain right now.");
  const maxFee = maxFeeFor(amount, quote);
  if (maxFee >= amount) throw new TransferError(`The amount does not cover the fee of up to ${formatUsdc(maxFee)} USDC.`);
  const mintRecipient = pad(recipient, { size: 32 });
  return {
    from,
    to,
    amount,
    maxFee,
    minReceived: amount - maxFee,
    finality: quote.finalityThreshold === FAST_FINALITY ? "fast" : "standard",
    approve: {
      to: from.usdc,
      token: from.usdc,
      spender: TOKEN_MESSENGER_V2,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [TOKEN_MESSENGER_V2, amount] }),
    },
    burn: {
      to: TOKEN_MESSENGER_V2,
      data: encodeFunctionData({
        abi: tokenMessengerAbi,
        functionName: "depositForBurnWithHook",
        args: [amount, to.domain, mintRecipient, from.usdc, pad("0x", { size: 32 }), maxFee, quote.finalityThreshold, FORWARD_HOOK],
      }),
    },
  };
}

export type TransferState = "NOT_FOUND" | "ATTESTING" | "MINTING" | "COMPLETE" | "FAILED";

export type TransferStatus = {
  state: TransferState;
  toChainId: number | null;
  amount: bigint | null;
  fee: bigint | null;
  mintTxHash: Hex | null;
  /** Why Circle holds the attestation back, as Circle names it. */
  delayReason: string | null;
  /** When forwarding failed: anyone can mint with this call on the destination chain, and the USDC still goes to the recipient. */
  manualMint: Call | null;
};

const bigOrNull = (v: string | null | undefined) => (v != null && /^\d+$/.test(v) ? BigInt(v) : null);

/** The state of one burn from the messages Iris returns for its transaction (the first CCTP message in it). */
export function readTransfer(messages: readonly IrisMessage[]): TransferStatus {
  const m = messages[0];
  const empty = { toChainId: null, amount: null, fee: null, mintTxHash: null, delayReason: null, manualMint: null };
  if (!m) return { state: "NOT_FOUND", ...empty };
  const body = m.decodedMessage?.decodedMessageBody;
  const domain = m.decodedMessage ? Number(m.decodedMessage.destinationDomain) : NaN;
  const base = {
    toChainId: cctpChainByDomain(domain)?.chainId ?? null,
    amount: bigOrNull(body?.amount),
    fee: bigOrNull(body?.feeExecuted),
    mintTxHash: m.forwardTxHash && /^0x[0-9a-fA-F]{64}$/.test(m.forwardTxHash) ? (m.forwardTxHash as Hex) : null,
    delayReason: m.delayReason ?? null,
    manualMint: null,
  };
  const attested = m.status === "complete" && m.attestation.startsWith("0x") && m.message.startsWith("0x") && m.message.length > 2;
  if (!attested) return { ...base, state: "ATTESTING" };
  const forward = (m.forwardState ?? "").toUpperCase();
  if (base.mintTxHash || forward === "COMPLETE" || forward === "CONFIRMED") return { ...base, state: "COMPLETE" };
  if (forward === "FAILED") {
    const data = encodeFunctionData({ abi: messageTransmitterAbi, functionName: "receiveMessage", args: [m.message as Hex, m.attestation as Hex] });
    return { ...base, state: "FAILED", manualMint: { to: MESSAGE_TRANSMITTER_V2, data } };
  }
  return { ...base, state: "MINTING" };
}

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
const formatUsdc = (raw: bigint) => `${raw / 1_000_000n}.${(raw % 1_000_000n).toString().padStart(6, "0")}`;
