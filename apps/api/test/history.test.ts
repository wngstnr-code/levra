import { describe, expect, it } from "vitest";
import type { ChainReader } from "../src/chain/reader";
import { buildHistory, pageHistory } from "../src/positions/account";
import type { StoredEvent } from "../src/positions/events";

const marketId = `0x${"aa".repeat(32)}` as const;
const reader = {
  deployment: { markets: [{ symbol: "QQQ", side: "long", marketId, oracle: marketId, collateralToken: marketId, loanToken: marketId, lltv: "770000000000000000" }] },
} as unknown as ChainReader;

const USDC = 1_000_000n;
const SHARE = 10n ** 18n;
let n = 0;
const ev = (name: string, args: Record<string, string | number>, source: StoredEvent["source"] = "router", txHash?: `0x${string}`): StoredEvent => ({
  source,
  name,
  marketId,
  txHash: txHash ?? `0x${(++n).toString(16).padStart(64, "0")}`,
  logIndex: 0,
  blockNumber: BigInt(n),
  blockTime: 1_791_876_000 + n,
  args,
});
const opened = (margin: bigint, debt: bigint, shares: bigint) =>
  ev("PositionOpened", { side: 0, margin: margin.toString(), debtDelta: debt.toString(), collateralDelta: shares.toString(), execPriceE8: "0", fee: "0" });
const reduced = (shares: bigint, debt: bigint, returned: bigint, reason = 0) =>
  ev("PositionReduced", { side: 0, collateralDelta: shares.toString(), debtDelta: debt.toString(), returned: returned.toString(), execPriceE8: "0", fee: "0", reason });

describe("history and realized PnL (three hand calculations)", () => {
  it("1. open $100 at 2x, close all for $130 back: +$30", () => {
    const items = buildHistory(reader, [opened(100n * USDC, 100n * USDC, SHARE / 4n), reduced(SHARE / 4n, 100n * USDC, 130n * USDC)]);
    expect(items.map((i) => i.type)).toEqual(["close", "open"]);
    expect(items[0]!.realizedPnlUsdRaw).toBe((30n * USDC).toString());
  });

  it("2. two opens of $100 and $50, sell a third of the stock for $60 back: 60 - 150/3 = +$10", () => {
    const items = buildHistory(reader, [
      opened(100n * USDC, 100n * USDC, 2n * SHARE),
      opened(50n * USDC, 50n * USDC, SHARE),
      reduced(SHARE, 50n * USDC, 60n * USDC),
    ]);
    expect(items[0]).toMatchObject({ type: "reduce", realizedPnlUsdRaw: (10n * USDC).toString() });
  });

  it("3. open $200, protection sells half for $80 back: 80 - 100 = -$20", () => {
    const items = buildHistory(reader, [opened(200n * USDC, 200n * USDC, 2n * SHARE), reduced(SHARE, 100n * USDC, 80n * USDC, 1)]);
    expect(items[0]).toMatchObject({ type: "autoReduce", realizedPnlUsdRaw: (-20n * USDC).toString() });
  });

  it("lists a debt repayment as repayDebt with its USDC amount", () => {
    const items = buildHistory(reader, [opened(100n * USDC, 100n * USDC, SHARE), ev("DebtRepaid", { assets: (20n * USDC).toString() })]);
    expect(items[0]).toMatchObject({ type: "repayDebt", usdAmountRaw: (20n * USDC).toString(), stockAmountRaw: null });
  });

  it("books a liquidation as the loss of the margin behind the seized stock", () => {
    const items = buildHistory(reader, [
      opened(100n * USDC, 100n * USDC, 2n * SHARE),
      ev("Liquidate", { seizedAssets: SHARE.toString(), repaidAssets: (90n * USDC).toString(), repaidShares: "0", badDebtAssets: "0", badDebtShares: "0" }, "morpho"),
    ]);
    expect(items[0]).toMatchObject({ type: "liquidation", stockAmountRaw: SHARE.toString(), usdAmountRaw: (90n * USDC).toString(), realizedPnlUsdRaw: (-50n * USDC).toString() });
  });

  it("shows Morpho actions taken directly, and hides the ones the router already reports", () => {
    const routerTx = `0x${"77".repeat(32)}` as const;
    const items = buildHistory(reader, [
      { ...opened(100n * USDC, 100n * USDC, SHARE), txHash: routerTx },
      ev("SupplyCollateral", { assets: SHARE.toString() }, "morpho", routerTx),
      ev("Borrow", { assets: (100n * USDC).toString(), shares: "1" }, "morpho", routerTx),
      ev("Borrow", { assets: (30n * USDC).toString(), shares: "1" }, "morpho"),
      ev("Supply", { assets: (500n * USDC).toString(), shares: "1" }, "morpho"),
    ]);
    expect(items.map((i) => i.type)).toEqual(["lend", "borrow", "open"]);
    expect(items[0]).toMatchObject({ side: null, usdAmountRaw: (500n * USDC).toString() });
    expect(items[1]).toMatchObject({ side: "long", usdAmountRaw: (30n * USDC).toString(), stockAmountRaw: null });
  });

  it("calls a short reduction a close when Morpho shows no borrow shares left, and a reduce otherwise", () => {
    const shortId = `0x${"bb".repeat(32)}` as const;
    const shortReader = { deployment: { markets: [{ symbol: "QQQ", side: "short", marketId: shortId }] } } as unknown as ChainReader;
    const inTx = (tx: string, name: string, args: Record<string, string | number>, source: StoredEvent["source"]) => ({ ...ev(name, args, source), marketId: shortId, txHash: tx as `0x${string}` });
    const open = `0x${"01".repeat(32)}`, half = `0x${"02".repeat(32)}`, rest = `0x${"03".repeat(32)}`;
    const items = buildHistory(shortReader, [
      inTx(open, "Borrow", { assets: "1", shares: "1000" }, "morpho"),
      inTx(open, "PositionOpened", { margin: "100", collateralDelta: "150", debtDelta: "1", fee: "0", execPriceE8: "0" }, "router"),
      inTx(half, "Repay", { assets: "1", shares: "400" }, "morpho"),
      inTx(half, "PositionReduced", { collateralDelta: "60", debtDelta: "1", returned: "40", fee: "0", execPriceE8: "0", reason: 0 }, "router"),
      inTx(rest, "Repay", { assets: "1", shares: "600" }, "morpho"),
      inTx(rest, "PositionReduced", { collateralDelta: "90", debtDelta: "1", returned: "60", fee: "0", execPriceE8: "0", reason: 0 }, "router"),
    ]);
    expect(items.map((i) => i.type)).toEqual(["close", "reduce", "open"]);
  });

  it("pages newest first and rejects an unknown cursor", () => {
    const all = buildHistory(reader, [opened(1n, 1n, 1n), opened(1n, 1n, 1n), opened(1n, 1n, 1n)]);
    const first = pageHistory(all, undefined, 2);
    expect(first.items).toHaveLength(2);
    const second = pageHistory(all, first.nextCursor ?? undefined, 2);
    expect(second).toMatchObject({ nextCursor: null });
    expect(second.items).toHaveLength(1);
    expect(() => pageHistory(all, "nope", 2)).toThrow();
  });
});
