import { describe, expect, it } from "vitest";
import { changeBps, chartValues } from "./priceSeries";

const pt = (t: number, price: string) => ({ timestamp: t, oraclePriceE8: price });

describe("priceSeries", () => {
  it("turns E8 prices into numbers for the chart", () => {
    expect(chartValues([pt(1, "74053500000"), pt(2, "11054000000")])).toEqual([740.535, 110.54]);
  });

  it("measures the change over the range in basis points", () => {
    expect(changeBps([pt(1, "10000000000"), pt(2, "10250000000")])).toBe(250);
    expect(changeBps([pt(1, "10000000000"), pt(2, "9900000000")])).toBe(-100);
    expect(changeBps([pt(1, "10000000000")])).toBeNull();
  });
});
