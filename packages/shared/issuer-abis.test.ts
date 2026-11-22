import { toFunctionSignature, type Abi } from "viem";
import { describe, expect, it } from "vitest";
import {
  anchoredComplianceAbi,
  b20PolicyRegistryAbi,
  b20TokenAbi,
  circleTokenAbi,
  morphoOracleAbi,
  sanctionsListAbi,
  xStockAbi,
} from "./abis";

const signatures = (abi: Abi) =>
  abi
    .filter((item) => item.type === "function")
    .map((item) => toFunctionSignature(item))
    .sort();

describe("issuer control ABIs (SC-88)", () => {
  it("match the calls the keeper makes", () => {
    expect(signatures(anchoredComplianceAbi)).toEqual(["isDenylisted(address)"]);
    expect(signatures(circleTokenAbi)).toEqual(["isBlacklisted(address)", "paused()"]);
    expect(signatures(b20TokenAbi)).toEqual(["isPaused(uint8)", "policyId(bytes32)"]);
    expect(signatures(b20PolicyRegistryAbi)).toEqual(["isAuthorized(uint64,address)"]);
    expect(signatures(xStockAbi)).toEqual(["asset()", "isPaused()"]);
    expect(signatures(sanctionsListAbi)).toEqual(["isSanctioned(address)"]);
    expect(signatures(morphoOracleAbi)).toEqual(["price()"]);
  });

  it("are read only", () => {
    for (const abi of [anchoredComplianceAbi, circleTokenAbi, b20TokenAbi, b20PolicyRegistryAbi, xStockAbi, sanctionsListAbi, morphoOracleAbi]) {
      for (const item of abi) if (item.type === "function") expect(item.stateMutability).toBe("view");
    }
  });
});
