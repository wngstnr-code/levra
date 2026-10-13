import { marginRouterAbi, riskManagerAbi } from "@levra/shared/abis";
import { BaseError, ContractFunctionRevertedError, decodeErrorResult, InsufficientFundsError, UserRejectedRequestError, type Hex } from "viem";
import { ApiRequestError } from "./api/client";
import type { Messages } from "./i18n/en";
import { TxGuardError } from "./txGuard";

const errorAbi = [...marginRouterAbi, ...riskManagerAbi];

/** The custom error name inside revert data, if it is one of ours. */
export function errorNameFromData(data: Hex): string | null {
  try {
    return decodeErrorResult({ abi: errorAbi, data }).errorName;
  } catch {
    return null;
  }
}

function revertName(err: BaseError): string | null {
  const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
  if (reverted instanceof ContractFunctionRevertedError && reverted.data?.errorName) return reverted.data.errorName;
  const withData = err.walk((e) => typeof (e as { data?: unknown }).data === "string" && ((e as { data: string }).data.startsWith("0x")));
  const data = (withData as { data?: Hex } | null)?.data;
  return data ? errorNameFromData(data) : null;
}

/** One plain sentence for anything that can go wrong around a transaction. */
export function describeError(err: unknown, m: Messages): string {
  if (err instanceof ApiRequestError) return m.errors.api[err.code];
  if (err instanceof TxGuardError) return err.message;
  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError)) return m.errors.rejected;
    if (err.walk((e) => e instanceof InsufficientFundsError)) return m.errors.insufficientGas;
    const name = revertName(err);
    if (name) return m.errors.contract[name] ?? `${m.errors.generic} (${name})`;
  }
  return m.errors.generic;
}
