import { withBuilderCode } from "@levra/shared/api";
import type { Hex } from "viem";

/** The ERC-8021 suffix for transactions the web app builds itself (D-108), or undefined on a chain without a code. API transactions already carry it. */
export function builderSuffix(chainId: number): Hex | undefined {
  const suffix = withBuilderCode(chainId, "0x");
  return suffix === "0x" ? undefined : suffix;
}
