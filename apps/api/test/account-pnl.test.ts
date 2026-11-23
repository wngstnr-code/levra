import { account } from "@levra/shared/api";
import { monadDeployment } from "@levra/shared/deployments/monad";
import { listMarkets } from "@levra/shared/markets";
import { describe, expect, it } from "vitest";
import type { ChainReader } from "../src/chain/reader";
import { buildAccount } from "../src/positions/account";
import type { StoredEvent } from "../src/positions/events";

const USDC = 1_000_000n;
const QQQ = listMarkets(monadDeployment).find((m) => m.symbol === "QQQ" && m.side === "long")!;
const USER = "0x00000000000000000000000000000000000000a1";

/** A reader with one QQQ long of 0.4 share and $100 of debt, the stock at `priceE8`. */
function readerAt(priceE8: bigint) {
  return {
    deployment: monadDeployment,
    usdc: { address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", decimals: 6 },
    morpho: monadDeployment.router,
    positions: async () => [{ marketId: QQQ.marketId, collateralRaw: 4n * 10n ** 17n, debtRaw: 100n * USDC, ltvWad: 5n * 10n ** 17n, softLtvWad: 6n * 10n ** 17n, lltvWad: 77n * 10n ** 16n, liqPriceE8: 0n, protection: false }],
    markets: async () => [{ info: QQQ, oraclePriceE8: priceE8, bidE8: priceE8, askE8: priceE8 }],
    latestBlock: async () => ({ number: 1n }),
    client: { multicall: async ({ contracts }: { contracts: unknown[] }) => contracts.map((_, i) => (i === contracts.length - 1 ? true : 0n)) },
  } as unknown as ChainReader;
}

// Opened with $100 of margin and $100 borrowed for 0.4 share (aQQQ has 18 decimals) at $500.
const opened: StoredEvent = {
  source: "router",
  name: "PositionOpened",
  marketId: QQQ.marketId,
  txHash: `0x${"01".repeat(32)}`,
  logIndex: 0,
  blockNumber: 1n,
  blockTime: 1_795_000_000,
  args: { side: 0, margin: (100n * USDC).toString(), debtDelta: (100n * USDC).toString(), collateralDelta: (4n * 10n ** 17n).toString(), execPriceE8: "50000000000", fee: "0" },
};

describe("position PnL in percent (BE-101)", () => {
  it("at $550: 0.4 share is worth $220, equity $120, PnL +$20 on $100 put in = +20%", async () => {
    const acc = account.parse(await buildAccount(readerAt(55_000_000_000n), [opened], USER));
    expect(acc.positions[0]).toMatchObject({ unrealizedPnlUsdRaw: (20n * USDC).toString(), pnlBps: 2_000 });
  });

  it("at $450: equity $80, PnL -$20 = -20%", async () => {
    const acc = account.parse(await buildAccount(readerAt(45_000_000_000n), [opened], USER));
    expect(acc.positions[0]).toMatchObject({ unrealizedPnlUsdRaw: (-20n * USDC).toString(), pnlBps: -2_000 });
  });

  it("is null for a position built straight on Morpho and for a market without a price", async () => {
    expect((await buildAccount(readerAt(55_000_000_000n), [], USER)).positions[0]!.pnlBps).toBeNull();
    expect((await buildAccount(readerAt(0n), [opened], USER)).positions[0]!.pnlBps).toBeNull();
  });
});
