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
const ev = (name: string, args: Record<string, string | number>): StoredEvent => ({
  name,
  marketId,
  txHash: `0x${(++n).toString(16).padStart(64, "0")}`,
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
