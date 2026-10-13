import { alertDeliveries, alertSettings, deposits, morphoEvents, routerEvents, type Db } from "@levra/db";
import { lensAbi } from "@levra/shared/abis";
import type { Deployment } from "@levra/shared/deployments";
import { WAD } from "@levra/shared/math";
import { and, eq, gte, inArray } from "drizzle-orm";
import { getAddress, type PublicClient } from "viem";
import { closeFromCalendar, type CloseSource } from "../protector/protector";
import type { Job } from "../runner";
import type { Channels } from "./channels";
import { linkTelegramChats, type TelegramSource } from "./telegram-link";

/** Before-close alerts (04 pre-close timeline): 24 hours, 4 hours and 1 hour before the close. */
export const PRE_CLOSE_STAGES = [86_400, 14_400, 3_600] as const;
/** Events older than this are not alerted, so a new or restarted keeper does not send old news. */
const EVENT_LOOKBACK_SECONDS = 86_400;
/** `PositionReduced.reason` for a keeper reduction (MarginRouter REASON_PROTECTION). */
const REASON_PROTECTION = 1;

/** The stage that is due now: the latest one reached before the close. A keeper that was down sends only that one. */
export function preCloseStage(now: number, closeAt: number): number | null {
  if (now >= closeAt) return null;
  const reached = PRE_CLOSE_STAGES.filter((s) => now >= closeAt - s);
  return reached.length === 0 ? null : Math.min(...reached);
}

const pct = (wad: bigint) => `${(Number((wad * 10_000n) / WAD) / 100).toFixed(2)}%`;
const hours = (s: number) => (s >= 86_400 ? "24 hours" : `${s / 3_600} hour${s === 3_600 ? "" : "s"}`);

export type Alert = { address: string; key: string; subject: string; text: string };

type Settings = typeof alertSettings.$inferSelect;
type MarketView = { marketId: string; softLtvClosed: bigint };

export type AlertsOptions = {
  client: PublicClient;
  deployment: Deployment;
  channels: Channels;
  telegram?: TelegramSource;
  nextClose?: CloseSource;
  /** Unix seconds. The chain's clock unless a test sets another. */
  clock?: () => Promise<number>;
  intervalMs?: number;
};

/**
 * User alerts (BE-33): before-close warnings for positions above the closed limit, an LTV over the user's threshold,
 * auto-deleverage, liquidation and arrived deposits. Each alert goes out once per channel (`alert_deliveries`); a
 * failed send is removed again so the next run retries it.
 */
export function createAlerts({ client, deployment, channels, telegram, nextClose = closeFromCalendar, clock, intervalMs = 60_000 }: AlertsOptions): Job {
  const chainClock = async () => Number((await client.getBlock({ blockTag: "latest" })).timestamp);
  const symbols = new Map(deployment.markets.map((m) => [m.marketId.toLowerCase(), `${m.symbol} ${m.side}`]));

  async function deliver(db: Db, s: Settings, alert: Alert): Promise<{ sent: number; failed: number }> {
    const targets: [string, () => Promise<void>][] = [];
    if (s.email && channels.email) targets.push(["email", () => channels.email!(s.email!, alert.subject, alert.text)]);
    if (s.telegramChatId && channels.telegram) targets.push(["telegram", () => channels.telegram!(s.telegramChatId!, `${alert.subject}\n\n${alert.text}`)]);
    let sent = 0;
    let failed = 0;
    for (const [channel, send] of targets) {
      const claimed = await db
        .insert(alertDeliveries)
        .values({ address: s.address, key: alert.key, channel, sentAt: new Date() })
        .onConflictDoNothing()
        .returning({ key: alertDeliveries.key });
      if (claimed.length === 0) continue;
      try {
        await send();
        sent += 1;
      } catch {
        failed += 1;
        await db.delete(alertDeliveries).where(and(eq(alertDeliveries.address, s.address), eq(alertDeliveries.key, alert.key), eq(alertDeliveries.channel, channel)));
      }
    }
    return { sent, failed };
  }

  return {
    name: "alerts",
    intervalMs,
    async run({ db, logger }) {
      const linked = telegram ? await linkTelegramChats(db, telegram) : 0;
      const now = await (clock ?? chainClock)();
      const users = (await db.select().from(alertSettings)).filter((s) => (s.email && channels.email) || (s.telegramChatId && channels.telegram));
      if (users.length === 0) return { linked, users: 0, sent: 0 };

      const markets: MarketView[] = (await client.readContract({ address: deployment.lens, abi: lensAbi, functionName: "getMarkets" })).map((m) => ({
        marketId: m.marketId.toLowerCase(),
        softLtvClosed: m.softLtvClosed,
      }));
      const closeAt = await nextClose(db, now);
      const stage = preCloseStage(now, closeAt);
      const since = new Date((now - EVENT_LOOKBACK_SECONDS) * 1000);
      const addresses = users.map((u) => u.address);
      const [reduced, liquidated, arrived] = await Promise.all([
        db.select().from(routerEvents).where(and(eq(routerEvents.name, "PositionReduced"), inArray(routerEvents.user, addresses), gte(routerEvents.blockTime, since))),
        db.select().from(morphoEvents).where(and(eq(morphoEvents.name, "Liquidate"), inArray(morphoEvents.user, addresses), gte(morphoEvents.blockTime, since))),
        db.select().from(deposits).where(and(eq(deposits.kind, "deposit"), eq(deposits.status, "SUCCESS"), inArray(deposits.user, addresses), gte(deposits.updatedAt, since))),
      ]);

      let sent = 0;
      let failed = 0;
      const send = async (s: Settings, alert: Omit<Alert, "address">) => {
        const r = await deliver(db, s, { ...alert, address: s.address });
        sent += r.sent;
        failed += r.failed;
      };

      for (const s of users) {
        const positions = (await client.readContract({ address: deployment.lens, abi: lensAbi, functionName: "getPositions", args: [getAddress(s.address)] })).filter(
          (p) => p.debt > 0n && symbols.has(p.marketId.toLowerCase()),
        );

        if (s.preClose && stage !== null) {
          const atRisk = positions.filter((p) => p.ltv > (markets.find((m) => m.marketId === p.marketId.toLowerCase())?.softLtvClosed ?? 0n));
          if (atRisk.length > 0) {
            const lines = atRisk.map((p) => {
              const closed = markets.find((m) => m.marketId === p.marketId.toLowerCase())!.softLtvClosed;
              return `${symbols.get(p.marketId.toLowerCase())}: LTV ${pct(p.ltv)}, closed-market limit ${pct(closed)}${p.protection ? " (protection on: it will be reduced 30 minutes before the close)" : ""}`;
            });
            await send(s, {
              key: `preclose:${closeAt}:${stage}`,
              subject: `The market closes in ${hours(stage)}`,
              text: `These positions are above the limit that applies while the market is closed. Prices can gap at the next open.\n\n${lines.join("\n")}\n\nAdd margin or reduce the position before the close.`,
            });
          }
        }

        if (s.ltvThresholdWad !== null) {
          const threshold = BigInt(s.ltvThresholdWad);
          for (const p of positions) {
            const key = `ltv:${p.marketId.toLowerCase()}`;
            if (p.ltv > threshold) {
              await send(s, { key, subject: `LTV above ${pct(threshold)}`, text: `${symbols.get(p.marketId.toLowerCase())}: LTV is ${pct(p.ltv)}, above your alert level of ${pct(threshold)}.` });
            } else {
              // Back under the level: the next crossing alerts again.
              await db.delete(alertDeliveries).where(and(eq(alertDeliveries.address, s.address), eq(alertDeliveries.key, key)));
            }
          }
        }

        const createdAt = s.createdAt.getTime();
        if (s.autoDeleverage) {
          for (const e of reduced.filter((r) => r.user === s.address && Number(r.args.reason) === REASON_PROTECTION && r.blockTime.getTime() >= createdAt)) {
            await send(s, { key: `deleverage:${e.txHash}:${e.logIndex}`, subject: "Position reduced by protection", text: `${symbols.get(e.marketId) ?? "A position"} was reduced before the close to bring it under the limit. Transaction: ${e.txHash}` });
          }
        }
        if (s.liquidation) {
          for (const e of liquidated.filter((r) => r.user === s.address && r.blockTime.getTime() >= createdAt)) {
            await send(s, { key: `liquidation:${e.txHash}:${e.logIndex}`, subject: "Position liquidated", text: `${symbols.get(e.marketId) ?? "A position"} passed the hard limit and was liquidated. Transaction: ${e.txHash}` });
          }
        }
        if (s.depositArrived) {
          for (const d of arrived.filter((r) => r.user === s.address && r.updatedAt.getTime() >= createdAt)) {
            await send(s, { key: `deposit:${d.id}`, subject: "Deposit arrived", text: `Your deposit arrived on Monad${d.destinationTxHash ? `. Transaction: ${d.destinationTxHash}` : "."}` });
          }
        }
      }

      if (failed > 0) throw new Error(`${failed} alert(s) could not be sent; they will be retried`);
      return { linked, users: users.length, closeAt, stage, sent };
    },
  };
}
