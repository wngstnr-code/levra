import { describe, expect, it } from "vitest";
import { smoothPath } from "./chartPath";

describe("smoothPath", () => {
  it("starts at the first point and closes the area to the bottom", () => {
    const { line, area, y } = smoothPath([1, 2, 3], 100, 50, 0);
    expect(line.startsWith("M 0.0 50.0")).toBe(true);
    expect(area.endsWith("L 100 50 L 0 50 Z")).toBe(true);
    expect(y(3)).toBe(0);
  });

  it("handles a flat series without dividing by zero", () => {
    expect(smoothPath([5, 5], 10, 10).line).not.toContain("NaN");
  });
});
