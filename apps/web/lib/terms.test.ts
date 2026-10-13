import { describe, expect, it } from "vitest";
import { termsMessage } from "./terms";

describe("termsMessage", () => {
  it("is the agreed text with the version and address", () => {
    expect(termsMessage("2026-10-13", "0xCFb0bE5E3218606fB541855f45711c981Ea9d0A5")).toBe(
      "Levra terms of use\nVersion: 2026-10-13\nAddress: 0xCFb0bE5E3218606fB541855f45711c981Ea9d0A5\nI confirm that I am not a resident of, or located in, a restricted region, that I read the risk disclosure, and that I accept the terms of use.",
    );
  });
});
