import { riskManagerAbi } from "@levra/shared/abis";
import { describe, expect, it } from "vitest";
import { encodeErrorResult } from "viem";
import { errorNameFromData } from "./contractErrors";

describe("errorNameFromData", () => {
  it("reads a RiskManager error from revert data", () => {
    const data = encodeErrorResult({ abi: riskManagerAbi, errorName: "OpeningIsPaused" });
    expect(errorNameFromData(data)).toBe("OpeningIsPaused");
  });

  it("returns null for data that is not one of ours", () => {
    expect(errorNameFromData("0x12345678")).toBeNull();
  });
});
