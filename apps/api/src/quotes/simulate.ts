import { marginRouterAbi, riskManagerAbi, sessionOracleAbi } from "@levra/shared/abis";
import type { Warning } from "@levra/shared/api";
import { BaseError, ContractFunctionRevertedError, decodeErrorResult, type Address, type Hex, type PublicClient } from "viem";
import { ApiHttpError } from "../errors";

const errorAbi = [...marginRouterAbi, ...riskManagerAbi, ...sessionOracleAbi].filter((item) => item.type === "error");

/** Monad charges the gas limit, not gas used (02), so the margin over the estimate is small. */
const GAS_MARGIN_BPS = 1_500n;

/** Contract errors that a quote explains as a blocking warning instead of failing. */
const blockingErrors: Record<string, Warning["code"]> = {
  SoftLimitExceeded: "NEAR_SOFT_LIMIT",
  UserLimitExceeded: "NEAR_SOFT_LIMIT",
  PriceDeviationTooHigh: "HIGH_DEVIATION",
  InsufficientSwapOutput: "HIGH_PRICE_IMPACT",
  PositionCapExceeded: "POSITION_CAP",
  OracleStale: "ORACLE_STALE",
};

function revertData(err: unknown): Hex | undefined {
  if (!(err instanceof BaseError)) return undefined;
  const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
  if (reverted?.raw) return reverted.raw;
  const withData = err.walk((e) => typeof (e as { data?: unknown }).data === "string") as { data?: Hex } | null;
  return withData?.data;
}

export type Simulation = { gasLimit: bigint; warning: null } | { gasLimit: 0n; warning: Warning };

/** Estimates gas for the call as the user. A known contract error becomes a blocking warning. */
export async function simulate(client: PublicClient, tx: { from: Address; to: Address; data: Hex }): Promise<Simulation> {
  try {
    const gas = await client.estimateGas({ account: tx.from, to: tx.to, data: tx.data });
    return { gasLimit: gas + (gas * GAS_MARGIN_BPS) / 10_000n, warning: null };
  } catch (err) {
    const data = revertData(err);
    if (!data || data === "0x") throw new ApiHttpError("UPSTREAM_ERROR", "Could not simulate the transaction.", undefined, err);
    let name: string;
    let args: readonly unknown[] | undefined;
    try {
      ({ errorName: name, args } = decodeErrorResult({ abi: errorAbi, data }));
    } catch {
      throw new ApiHttpError("BAD_REQUEST", "The transaction would fail on chain.", { revert: data });
    }
    const code = blockingErrors[name];
    if (!code) {
      const detail = name === "Error" && typeof args?.[0] === "string" ? `: ${args[0]}` : "";
      throw new ApiHttpError("BAD_REQUEST", `The transaction would fail on chain: ${name}${detail}.`, {
        error: name,
        args: args?.map((a) => (typeof a === "bigint" ? a.toString() : a)),
      });
    }
    return { gasLimit: 0n, warning: { code, severity: "block", message: `The contract would reject this now (${name}).` } };
  }
}
