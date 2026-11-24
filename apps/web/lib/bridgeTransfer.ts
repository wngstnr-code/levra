import type { BridgePlan, BridgeState, Call } from "@levra/shared/api";
import { cctpChain, MESSAGE_TRANSMITTER_V2, messageTransmitterAbi, TOKEN_MESSENGER_V2, tokenMessengerAbi } from "@levra/cctp";
import { decodeFunctionData, erc20Abi, pad, type Address, type Hex } from "viem";
import type { Config } from "wagmi";
import { readContract, sendTransaction, switchChain, waitForTransactionReceipt } from "wagmi/actions";

export type BridgeStep = "switching" | "approving" | "burning" | "sent";

/** The burn needs an approval first only when the allowance does not cover the amount. */
export function needsApprove(allowance: bigint, amountRaw: string): boolean {
  return allowance < BigInt(amountRaw);
}

/** Polling stops once Circle has finished, either way. */
export function bridgeDone(state: BridgeState | undefined): boolean {
  return state === "COMPLETE" || state === "FAILED";
}

async function send(config: Config, chainId: number, account: Address, call: Call): Promise<Hex> {
  const hash = await sendTransaction(config, { account, to: call.to, data: call.data, chainId });
  const receipt = await waitForTransactionReceipt(config, { hash, chainId });
  if (receipt.status !== "success") throw new Error("reverted");
  return hash;
}

/** Switches the wallet to the source chain, approves when needed, burns, and returns the burn hash for the status. */
export async function runBridgePlan(config: Config, account: Address, plan: BridgePlan, onStep: (s: BridgeStep) => void): Promise<Hex> {
  onStep("switching");
  await switchChain(config, { chainId: plan.fromChainId });
  const allowance = await readContract(config, { address: plan.approve.token, abi: erc20Abi, functionName: "allowance", args: [account, plan.approve.spender], chainId: plan.fromChainId });
  if (needsApprove(allowance, plan.amountRaw)) {
    onStep("approving");
    await send(config, plan.fromChainId, account, plan.approve);
  }
  onStep("burning");
  const hash = await send(config, plan.fromChainId, account, plan.burn);
  onStep("sent");
  return hash;
}

/** When forwarding failed, anyone can send Circle's mint on the destination chain; the USDC still goes to the recipient. */
export async function runManualMint(config: Config, account: Address, toChainId: number, call: Call): Promise<Hex> {
  checkManualMint(call);
  await switchChain(config, { chainId: toChainId });
  return send(config, toChainId, account, call);
}

export class UnsafePlanError extends Error {}

/**
 * Checks a plan from the API against what the user asked for before the wallet signs it: the right chains and amount,
 * USDC approved only to Circle's TokenMessenger for that amount, and a burn that mints to the user's own address on the
 * chosen chain. A wrong or tampered plan never reaches the wallet.
 */
export function checkBridgePlan(plan: BridgePlan, want: { fromChainId: number; toChainId: number; amountRaw: bigint; recipient: Address }): void {
  const from = cctpChain(want.fromChainId);
  const to = cctpChain(want.toChainId);
  const fail = (why: string) => {
    throw new UnsafePlanError(why);
  };
  if (!from || !to) return fail("unknown chain");
  if (plan.fromChainId !== want.fromChainId || plan.toChainId !== want.toChainId) fail("chain");
  if (BigInt(plan.amountRaw) !== want.amountRaw) fail("amount");
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (!same(plan.approve.to, from.usdc) || !same(plan.approve.token, from.usdc) || !same(plan.approve.spender, TOKEN_MESSENGER_V2)) fail("approve target");
  const approve = decodeFunctionData({ abi: erc20Abi, data: plan.approve.data });
  if (approve.functionName !== "approve" || !same(approve.args[0], TOKEN_MESSENGER_V2) || approve.args[1] !== want.amountRaw) fail("approve call");
  if (!same(plan.burn.to, TOKEN_MESSENGER_V2)) fail("burn target");
  const burn = decodeFunctionData({ abi: tokenMessengerAbi, data: plan.burn.data });
  const [amount, domain, mintRecipient, burnToken, , maxFee] = burn.args;
  if (amount !== want.amountRaw || domain !== to.domain || !same(burnToken, from.usdc)) fail("burn call");
  if (!same(mintRecipient, pad(want.recipient, { size: 32 }))) fail("recipient");
  if (maxFee >= want.amountRaw || BigInt(plan.maxFeeRaw) !== maxFee) fail("fee");
}

/** The manual mint from the status must be Circle's own `receiveMessage` on the MessageTransmitter. */
export function checkManualMint(call: Call): void {
  if (call.to.toLowerCase() !== MESSAGE_TRANSMITTER_V2.toLowerCase()) throw new UnsafePlanError("mint target");
  if (decodeFunctionData({ abi: messageTransmitterAbi, data: call.data }).functionName !== "receiveMessage") throw new UnsafePlanError("mint call");
}

const SAVED_KEY = "levra.bridge";

export type SavedBurn = { hash: Hex; plan: BridgePlan; at: number };

/** The last burn per wallet, so a reload or a closed tab can still follow it and finish a manual mint. */
export function loadBurn(user: Address): SavedBurn | null {
  try {
    const raw = localStorage.getItem(`${SAVED_KEY}.${user.toLowerCase()}`);
    return raw ? (JSON.parse(raw) as SavedBurn) : null;
  } catch {
    return null;
  }
}

export function saveBurn(user: Address, burn: SavedBurn | null): void {
  try {
    const key = `${SAVED_KEY}.${user.toLowerCase()}`;
    if (burn) localStorage.setItem(key, JSON.stringify(burn));
    else localStorage.removeItem(key);
  } catch {
    // Storage can be off; the transfer still completes, only the resume is lost.
  }
}
