import { builderCodes, withBuilderCode } from "@levra/shared/api";
import { encodeFunctionData, erc4626Abi } from "viem";
import { describe, expect, it } from "vitest";
import { builderSuffix } from "./builderCode";

const deposit = encodeFunctionData({ abi: erc4626Abi, functionName: "deposit", args: [1_000_000n, "0x00000000000000000000000000000000000000aa"] });

describe("builderSuffix", () => {
  it("adds Levra's code to a Base Earn deposit", () => {
    expect(builderCodes[8453]).toBeTruthy();
    const suffix = builderSuffix(8453)!;
    expect(`${deposit}${suffix.slice(2)}`).toBe(withBuilderCode(8453, deposit));
  });

  it("adds nothing on Monad or X Layer", () => {
    expect(builderSuffix(143)).toBeUndefined();
    expect(builderSuffix(196)).toBeUndefined();
  });
});
