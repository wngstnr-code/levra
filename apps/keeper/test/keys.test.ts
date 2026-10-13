import { describe, expect, it } from "vitest";
import { parseEther, type Address } from "viem";
import { ROLES, planTopUps } from "../scripts/roles";

const a = (n: number) => `0x${String(n).padStart(40, "0")}` as Address;

describe("keeper roles", () => {
  it("has one key per role, each granted by its own owner call", () => {
    expect(Object.keys(ROLES)).toEqual(["ORACLE_AGE_POSTER_KEY", "CALENDAR_POSTER_KEY", "PROTECTOR_KEY", "LIQUIDATOR_KEY"]);
    const d = { riskManager: a(1), router: a(2), liquidator: a(3) } as never;
    expect(ROLES.PROTECTOR_KEY.grant(d, a(9))).toBe(`cast send ${a(2)} "setKeeper(address,bool)" ${a(9)} true`);
    expect(ROLES.LIQUIDATOR_KEY.revoke(d, a(9))).toBe(`cast send ${a(3)} "setKeeper(address,bool)" ${a(9)} false`);
  });
});

describe("MON top-ups", () => {
  const limits = { targetWei: parseEther("10"), maxPerWalletWei: parseEther("6"), maxTotalWei: parseEther("9") };
  it("fills the emptiest wallets first, up to the target, within the per-wallet and per-run caps", () => {
    const plan = planTopUps(
      [
        { role: "full", address: a(1), balanceWei: parseEther("12") },
        { role: "low", address: a(2), balanceWei: parseEther("7") },
        { role: "empty", address: a(3), balanceWei: 0n },
      ],
      limits,
    );
    expect(plan.map((p) => [p.role, p.sendWei])).toEqual([
      ["empty", parseEther("6")],
      ["low", parseEther("3")],
      ["full", 0n],
    ]);
  });

  it("stops at the per-run cap", () => {
    const plan = planTopUps([1, 2, 3].map((n) => ({ role: `r${n}`, address: a(n), balanceWei: 0n })), limits);
    expect(plan.map((p) => p.sendWei)).toEqual([parseEther("6"), parseEther("3"), 0n]);
  });
});