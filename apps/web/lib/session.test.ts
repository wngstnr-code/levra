import { describe, expect, it } from "vitest";
import { sessionFromIndex } from "./session";

describe("sessionFromIndex", () => {
  it("follows the oracle enum order", () => {
    expect(sessionFromIndex(0)).toBe("UNKNOWN");
    expect(sessionFromIndex(2)).toBe("REGULAR");
    expect(sessionFromIndex(4)).toBe("OVERNIGHT");
    expect(sessionFromIndex(5)).toBe("CLOSED");
  });

  it("treats an index it does not know as unknown", () => {
    expect(sessionFromIndex(9)).toBe("UNKNOWN");
  });
});
