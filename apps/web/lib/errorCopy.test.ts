import { marginRouterAbi, riskManagerAbi, sessionOracleAbi } from "@levra/shared/abis";
import { apiErrorCode } from "@levra/shared/api";
import { describe, expect, it } from "vitest";
import { en } from "./i18n/en";

const userFacingAbis = [marginRouterAbi, riskManagerAbi, sessionOracleAbi];

describe("error copy", () => {
  it("explains every error the router, risk manager and session oracle can raise", () => {
    const names = new Set(userFacingAbis.flatMap((abi) => abi.filter((x) => x.type === "error").map((x) => (x as { name: string }).name)));
    const missing = [...names].filter((n) => !en.errors.contract[n]);
    expect(missing).toEqual([]);
  });

  it("explains every API error code", () => {
    for (const code of apiErrorCode.options) expect(en.errors.api[code]).toBeTruthy();
  });
});
