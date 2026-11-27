import { getAddress, isAddress, type Address, type Hex } from "viem";
import { AcrossError, approveAction, sendAction, type AcrossQuote, type AcrossQuoteRequest } from "./client";

/** The least time left before the deposit must land, for the user to read, sign and get it mined (initial proposal). */
export const MIN_VALIDITY_MS = 60_000;

export type DepositPlan = {
  orderId: string;
  /** When the deposit must have landed: Across's `originValidUntil`, or `expiresAt` without it. */
  expiresAtMs: number;
  estimatedSeconds: number | null;
  amountRaw: bigint;
  expectedReceivedRaw: bigint;
  minReceivedRaw: bigint;
  /** Across's whole fee, in the output token (checked when Across names the fee's token). */
  feeRaw: bigint;
  /**
   * Null only for the native token. Always sent for a token, even over an existing allowance: approve sets the allowance
   * to exactly `amountRaw`, and the deposit pulls everything the allowance lets it.
   */
  approve: { token: Address; spender: Address; amountRaw: bigint; resetFirst: boolean } | null;
  /** The deposit itself, sent on the origin chain. */
  deposit: { to: Address; data: Hex; valueRaw: bigint };
};

/** The native token as Across names it: the zero address or the 0xEeee placeholder. */
export const isNative = (token: string) => /^0x0{40}$/i.test(token) || /^0xe{40}$/i.test(token);

const same = (a: string, b: string) =>
  (isNative(a) && isNative(b)) || (isAddress(a, { strict: false }) && isAddress(b, { strict: false }) && getAddress(a) === getAddress(b));

/** Whole bytes, with at least a 4 byte selector. */
const isCallData = (data: string): data is Hex => /^0x([0-9a-fA-F]{2}){4,}$/.test(data);

function bad(why: string): never {
  throw new AcrossError("UPSTREAM_ERROR", `Across sent a quote this API will not pass on: ${why}.`);
}

/**
 * Checks an approval-funded Across quote against what was asked and turns it into calls for the user's wallet. Anything
 * the quote changed (token, amount, depositor, recipient, output token, the fee's token), any step a plain wallet cannot
 * do, an approval of another token or amount, a token deposit without its approval, a native value on a token deposit,
 * or a quote with less than `MIN_VALIDITY_MS` left stops it: the calls are signed by the user, so nothing Across did not
 * promise for this request may reach the wallet.
 */
export function planDeposit(req: AcrossQuoteRequest, q: AcrossQuote, nowMs: number): DepositPlan {
  const native = isNative(req.inputToken);
  if (q.origin.token.chainId !== req.originChainId || !same(q.origin.token.address, req.inputToken)) bad("another input token");
  if (BigInt(q.origin.amount) !== req.amountRaw) bad("another input amount");
  if (!same(q.origin.depositor.address, req.depositor)) bad("another depositor");
  if (q.destination.token.chainId !== req.destinationChainId || !same(q.destination.token.address, req.outputToken)) bad("another output token");
  if (!same(q.destination.recipient.address, req.recipient)) bad("another recipient");
  const feeToken = q.fee.totalFee.token;
  if (feeToken && (feeToken.chainId !== req.destinationChainId || !same(feeToken.address, req.outputToken))) bad("a fee in another token");

  const expected = BigInt(q.destination.amount);
  const min = BigInt(q.destination.minAmount);
  if (min === 0n || min > expected) bad("no guaranteed amount");

  const expiresAtMs = Date.parse(q.originValidUntil ?? q.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs - nowMs < MIN_VALIDITY_MS) bad("it expires too soon");

  let reset: { token: string; spender: string } | null = null;
  let approve: DepositPlan["approve"] = null;
  let deposit: DepositPlan["deposit"] | null = null;
  for (const [i, action] of q.nextActions.entries()) {
    const ap = approveAction.safeParse(action);
    const sd = sendAction.safeParse(action);
    const chainId = ap.success ? ap.data.chainId : sd.success ? sd.data.chainId : undefined;
    if (chainId !== undefined && chainId !== req.originChainId) bad("a step on another chain");
    if (ap.success && approve === null && deposit === null) {
      const a = ap.data;
      if (native || !same(a.tokenAddress, req.inputToken)) bad("an approval of another token");
      if (!isAddress(a.spender, { strict: false })) bad("an approval without a spender");
      // USDT-class tokens refuse a change between two non-zero allowances, so Across may first set it to zero.
      if (BigInt(a.amount) === 0n && reset === null) {
        reset = { token: a.tokenAddress, spender: a.spender };
        continue;
      }
      if (BigInt(a.amount) !== req.amountRaw) bad("an approval of another amount");
      if (reset && !same(reset.spender, a.spender)) bad("a reset for another spender");
      approve = { token: getAddress(a.tokenAddress), spender: getAddress(a.spender), amountRaw: req.amountRaw, resetFirst: reset !== null };
    } else if (sd.success && sd.data.id === "prefunded-store" && i === q.nextActions.length - 1) {
      const a = sd.data;
      if (!isAddress(a.to, { strict: false }) || !isCallData(a.data)) bad("a deposit without a target or call");
      const value = BigInt(a.value);
      if (value !== (native ? req.amountRaw : 0n)) bad("a deposit with an unexpected native value");
      deposit = { to: getAddress(a.to), data: a.data, valueRaw: value };
    } else {
      bad(`a step this wallet flow does not run (${action.kind})`);
    }
  }
  if (!deposit) bad("no deposit transaction");
  if (reset && !approve) bad("a reset without its approval");
  // Without our own exact approval an older, larger allowance would let the deposit pull more than the user asked.
  if (!native && !approve) bad("a token deposit without its approval");

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
