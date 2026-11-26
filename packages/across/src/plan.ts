import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";
import { AcrossError, approveAction, sendAction, type AcrossQuote, type AcrossQuoteRequest } from "./client";

export type DepositPlan = {
  orderId: string;
  expiresAtMs: number;
  estimatedSeconds: number | null;
  amountRaw: bigint;
  expectedReceivedRaw: bigint;
  minReceivedRaw: bigint;
  /** Across's whole fee, in the output token. */
  feeRaw: bigint;
  /** Null when the wallet's allowance already covers the amount. */
  approve: { token: Address; spender: Address; amountRaw: bigint } | null;
  /** The deposit itself, sent on the origin chain. */
  deposit: { to: Address; data: Hex; valueRaw: bigint };
};

/** The native token as Across names it: the zero address or the 0xEeee placeholder. */
export const isNative = (token: string) => /^0x0{40}$/i.test(token) || /^0xe{40}$/i.test(token);

const same = (a: string, b: string) => isAddress(a, { strict: false }) && isAddress(b, { strict: false }) && getAddress(a) === getAddress(b);

function bad(why: string): never {
  throw new AcrossError("UPSTREAM_ERROR", `Across sent a quote this API will not pass on: ${why}.`);
}

/**
 * Checks an approval-funded Across quote against what was asked and turns it into calls for the user's wallet. Anything
 * the quote changed (token, amount, depositor, recipient, output token), any step a plain wallet cannot do, an approval
 * of another token or amount, a native value on a token deposit, or an expired quote stops it: the calls are signed by
 * the user, so nothing Across did not promise for this request may reach the wallet.
 */
export function planDeposit(req: AcrossQuoteRequest, q: AcrossQuote, nowMs: number): DepositPlan {
  if (q.origin.token.chainId !== req.originChainId || !same(q.origin.token.address, req.inputToken)) bad("another input token");
  if (BigInt(q.origin.amount) !== req.amountRaw) bad("another input amount");
  if (!same(q.origin.depositor.address, req.depositor)) bad("another depositor");
  if (q.destination.token.chainId !== req.destinationChainId || !same(q.destination.token.address, req.outputToken)) bad("another output token");
  if (!same(q.destination.recipient.address, req.recipient)) bad("another recipient");

  const expected = BigInt(q.destination.amount);
  const min = BigInt(q.destination.minAmount);
  if (min === 0n || min > expected) bad("no guaranteed amount");

  const expiresAtMs = Date.parse(q.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) bad("it has expired");

  let approve: DepositPlan["approve"] = null;
  let deposit: DepositPlan["deposit"] | null = null;
  for (const [i, action] of q.nextActions.entries()) {
    const ap = approveAction.safeParse(action);
    const sd = sendAction.safeParse(action);
    const chainId = ap.success ? ap.data.chainId : sd.success ? sd.data.chainId : undefined;
    if (chainId !== undefined && chainId !== req.originChainId) bad("a step on another chain");
    if (ap.success && approve === null && deposit === null) {
      const a = ap.data;
      if (isNative(req.inputToken) || !same(a.tokenAddress, req.inputToken)) bad("an approval of another token");
      if (BigInt(a.amount) !== req.amountRaw) bad("an approval of another amount");
      if (!isAddress(a.spender, { strict: false })) bad("an approval without a spender");
      approve = { token: getAddress(a.tokenAddress), spender: getAddress(a.spender), amountRaw: BigInt(a.amount) };
    } else if (sd.success && sd.data.id === "prefunded-store" && i === q.nextActions.length - 1) {
      const a = sd.data;
      if (!isAddress(a.to, { strict: false }) || !isHex(a.data) || a.data.length < 10) bad("a deposit without a target or call");
      const value = BigInt(a.value);
      if (value !== (isNative(req.inputToken) ? req.amountRaw : 0n)) bad("a deposit with an unexpected native value");
      deposit = { to: getAddress(a.to), data: a.data, valueRaw: value };
    } else {
      bad(`a step this wallet flow does not run (${action.kind})`);
    }
  }
  if (!deposit) bad("no deposit transaction");

  return {
    orderId: q.orderId,
    expiresAtMs,
    estimatedSeconds: q.expectedFillTimeMs == null ? null : Math.ceil(q.expectedFillTimeMs / 1000),
    amountRaw: req.amountRaw,
    expectedReceivedRaw: expected,
    minReceivedRaw: min,
    feeRaw: BigInt(q.fee.totalFee.amount),
    approve,
    deposit,
  };
}
