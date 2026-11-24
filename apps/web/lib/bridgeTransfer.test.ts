import { describe, expect, it } from "vitest";
import { bridgeDone, needsApprove } from "./bridgeTransfer";

describe("bridge transfer", () => {
  it("approves only when the allowance is short", () => {
    expect(needsApprove(0n, "1000000")).toBe(true);
    expect(needsApprove(999_999n, "1000000")).toBe(true);
    expect(needsApprove(1_000_000n, "1000000")).toBe(false);
  });
  it("stops polling on complete or failed", () => {
    expect(bridgeDone("COMPLETE")).toBe(true);
    expect(bridgeDone("FAILED")).toBe(true);
    expect(bridgeDone("ATTESTING")).toBe(false);
    expect(bridgeDone(undefined)).toBe(false);
  });
});
