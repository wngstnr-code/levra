import { describe, expect, it } from "vitest";
import { TRANSFER_GAS, parseSweepArgs, sweepAmount } from "../scripts/sweep";

const NEW_A = "0x1111111111111111111111111111111111111111";
const NEW_B = "0x2222222222222222222222222222222222222222";

describe("parseSweepArgs", () => {
  it("reads the service, the role pairs and --confirm", () => {
    const args = parseSweepArgs(["--from", "keeper", `PROTECTOR_KEY=${NEW_A}`, `LIQUIDATOR_KEY=${NEW_B}`, "--confirm"]);
    expect(args.from).toBe("keeper");
    expect(args.confirm).toBe(true);
    expect(args.moves).toEqual([
      { role: "PROTECTOR_KEY", to: NEW_A },
      { role: "LIQUIDATOR_KEY", to: NEW_B },
    ]);
  });

  it("is a dry run without --confirm", () => {
    expect(parseSweepArgs(["--from", "keeper", `PROTECTOR_KEY=${NEW_A}`]).confirm).toBe(false);
  });

  it("refuses a missing service, unknown roles, bad addresses and no pairs", () => {
    expect(() => parseSweepArgs([`PROTECTOR_KEY=${NEW_A}`])).toThrow("--from");
    expect(() => parseSweepArgs(["--from", "keeper", `OWNER_KEY=${NEW_A}`])).toThrow("ROLE=0x");
    expect(() => parseSweepArgs(["--from", "keeper", "PROTECTOR_KEY=0x1234"])).toThrow("ROLE=0x");
    expect(() => parseSweepArgs(["--from", "keeper", NEW_A])).toThrow("ROLE=0x");
    expect(() => parseSweepArgs(["--from", "keeper"])).toThrow("one or more");
  });

  it("refuses a role named twice or two roles to one address", () => {
    expect(() => parseSweepArgs(["--from", "keeper", `PROTECTOR_KEY=${NEW_A}`, `PROTECTOR_KEY=${NEW_B}`])).toThrow("twice");
    expect(() => parseSweepArgs(["--from", "keeper", `PROTECTOR_KEY=${NEW_A}`, `LIQUIDATOR_KEY=${NEW_A.toUpperCase().replace("0X", "0x")}`])).toThrow("same new address");
  });
});

describe("sweepAmount", () => {
  const maxFee = 200_000_000_000n;

  it("moves everything but the fee for the gas limit", () => {
    const balance = 10_000_000_000_000_000_000n;
    expect(sweepAmount(balance, maxFee)).toBe(balance - TRANSFER_GAS * maxFee);
  });

  it("sends nothing when the balance does not cover the fee", () => {
    expect(sweepAmount(TRANSFER_GAS * maxFee, maxFee)).toBe(0n);
    expect(sweepAmount(1n, maxFee)).toBe(0n);
    expect(sweepAmount(0n, maxFee)).toBe(0n);
  });
});
