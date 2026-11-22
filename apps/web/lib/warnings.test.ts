import { warning } from "@levra/shared/api";
import { describe, expect, it } from "vitest";
import { en } from "./i18n/en";
import { noticeFor, warningCodes } from "./warnings";

describe("quote warnings", () => {
  it("has a designed notice for every warning code in the shared schema", () => {
    const codes = warning.shape.code.options;
    expect([...warningCodes].sort()).toEqual([...codes].sort());
    for (const code of codes) expect(en.notices[code].title.length).toBeGreaterThan(0);
  });

  it("blocks the trade only for block warnings", () => {
    expect(noticeFor({ code: "POSITION_CAP", severity: "block", message: "x" }, en).blocks).toBe(true);
    expect(noticeFor({ code: "NEAR_SOFT_LIMIT", severity: "warn", message: "x" }, en).blocks).toBe(false);
  });
});
