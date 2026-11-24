import type { BridgePlan, BridgeState, Call } from "@levra/shared/api";
import { erc20Abi, type Address, type Hex } from "viem";
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
  await switchChain(config, { chainId: toChainId });
  return send(config, toChainId, account, call);
}
