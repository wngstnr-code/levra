import { describe, expect, it } from "vitest";
import { upgradeState } from "./useRouterUpgrade";

const A = "0x00000000000000000000000000000000000000aa";
const B = "0x00000000000000000000000000000000000000bb";

describe("upgradeState", () => {
  it("is empty when there is no old router", () => {
    expect(upgradeState([], ["QQQ", "SPY"], [true, true])).toEqual({ oldAccess: [], protectionToRestore: [] });
  });

  it("lists old routers that still have access", () => {
    expect(upgradeState([A, B], [], [false, true]).oldAccess).toEqual([B]);
  });

  it("asks to turn protection on again only where the old router had it and the new one does not", () => {
    // access A; new: QQQ off, SPY on; old A: QQQ on, SPY on
    expect(upgradeState([A], ["QQQ", "SPY"], [false, false, true, true, true]).protectionToRestore).toEqual(["QQQ"]);
  });

  it("reports nothing for failed reads", () => {
    expect(upgradeState([A], ["QQQ"], [])).toEqual({ oldAccess: [], protectionToRestore: [] });
  });

  it("does not ask again when the current router read failed", () => {
    expect(upgradeState([A], ["QQQ"], [false, undefined, true]).protectionToRestore).toEqual([]);
  });
});
