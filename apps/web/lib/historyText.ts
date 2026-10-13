import type { HistoryItem } from "@levra/shared/api";
import { formatUsdE8 } from "./format";
import type { Messages } from "./i18n/en";
import { stockOf } from "./deployment";
import { formatToken, formatUsd, formatUsdSigned } from "./units";

const DASH = "—";

/** One plain sentence for a history item: what happened, at what price, what it cost, what is left. */
export function historySentence(item: HistoryItem, m: Messages): string {
  const t = m.history.text;
  const stock = stockOf(item.symbol);
  const stockAmt = item.stockAmountRaw && stock ? `${formatToken(item.stockAmountRaw, stock.decimals)} ${stock.tokenSymbol}` : DASH;
  const usd = item.usdAmountRaw ? formatUsd(item.usdAmountRaw) : DASH;
  const price = item.execPriceE8 ? formatUsdE8(BigInt(item.execPriceE8)) : DASH;
  const fee = item.feeRaw ? formatUsd(item.feeRaw) : formatUsd(0n);
  const amount = item.usdAmountRaw ? `${formatToken(item.usdAmountRaw, 6, 2)} USDC` : stockAmt;
  switch (item.type) {
    case "open":
      return item.side === "short" ? t.openShort(stockAmt, price, usd, fee) : t.openLong(stockAmt, price, usd, fee);
    case "reduce":
      return item.side === "short" ? t.reduceShort(stockAmt, price, usd) : t.reduceLong(stockAmt, price, usd);
    case "close":
      return t.close(usd, item.realizedPnlUsdRaw ? formatUsdSigned(item.realizedPnlUsdRaw) : DASH);
    case "addCollateral":
      return t.addCollateral(amount);
    case "removeCollateral":
      return t.removeCollateral(amount);
    case "repayDebt":
      return t.repayDebt(amount);
    case "borrow":
      return t.borrow(amount);
    case "autoReduce":
      return t.autoReduce(stockAmt, price, fee);
    case "liquidation":
      return t.liquidation(usd, stockAmt);
    case "lend":
      return t.lend(amount);
    case "withdrawLend":
      return t.withdrawLend(amount);
  }
}
