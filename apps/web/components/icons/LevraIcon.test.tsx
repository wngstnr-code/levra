import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LevraIcon, levraIconNames } from "./LevraIcon";

describe("LevraIcon", () => {
  it("has the twelve product icons", () => {
    expect(levraIconNames).toHaveLength(12);
  });

  it("draws every icon as one stroked path on the 24 px grid", () => {
    for (const name of levraIconNames) {
      const html = renderToStaticMarkup(<LevraIcon name={name} />);
      expect(html).toContain('viewBox="0 0 24 24"');
      expect(html).toMatch(/<path d="M[^"]+"/);
    }
  });
});
