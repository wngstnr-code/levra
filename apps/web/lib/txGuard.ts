import { marginRouterAbi } from "@levra/shared/abis";
import type { TxRequest } from "@levra/shared/api";
import { decodeFunctionData, isAddressEqual, type Hex } from "viem";

export type RouterCall = { name: string; args: readonly unknown[] };

export class TxGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TxGuardError";
  }
}

/** Calls the router may receive alongside the main action inside one multicall. */
const SETUP_CALLS = new Set(["permitToken", "authorizeWithSig"]);

export function decodeRouterCalls(data: Hex): RouterCall[] {
  const top = decodeFunctionData({ abi: marginRouterAbi, data });
  if (top.functionName !== "multicall") return [{ name: top.functionName, args: top.args ?? [] }];
  const inner = (top.args?.[0] ?? []) as readonly Hex[];
  return inner.map((d) => {
    const c = decodeFunctionData({ abi: marginRouterAbi, data: d });
    return { name: c.functionName, args: c.args ?? [] };
  });
}

/**
 * Checks a transaction the service built before the wallet sees it (D-19): it must go to our router,
 * contain exactly the expected action plus optional setup calls, and act on the market shown on screen.
 */
export function guardRouterTx(tx: TxRequest, p: { router: Hex; action: string; marketId?: Hex }): RouterCall[] {
  if (!isAddressEqual(tx.to, p.router)) throw new TxGuardError("The transaction does not go to the Levra router.");
  let calls: RouterCall[];
  try {
    calls = decodeRouterCalls(tx.data);
  } catch {
    throw new TxGuardError("The transaction data could not be read.");
  }
  const main = calls.filter((c) => !SETUP_CALLS.has(c.name));
  if (main.length !== 1 || main[0]!.name !== p.action) throw new TxGuardError(`The transaction does not match the action ${p.action}.`);
  if (p.marketId) {
    const first = main[0]!.args[0];
    const id = typeof first === "object" && first !== null && "marketId" in first ? (first as { marketId: Hex }).marketId : (first as Hex);
    if (typeof id !== "string" || id.toLowerCase() !== p.marketId.toLowerCase()) throw new TxGuardError("The transaction acts on a different market.");
  }
  return calls;
}
