import { activeGates, alertDeliveries, alertSettings, deposits, monitorState, morphoEvents, routerEvents, type Db } from "@levra/db";
import { lensAbi } from "@levra/shared/abis";
import { chains } from "@levra/shared/chains";
import type { Deployment } from "@levra/shared/deployments";
import { WAD } from "@levra/shared/math";
import { and, eq, gte, inArray, like } from "drizzle-orm";
import { erc20Abi, getAddress, type PublicClient } from "viem";
import { GATE_EFFECT } from "../monitor/checks";
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

/** An issuer control the team monitor sees blocking (BE-75): `symbol` is the one stock it covers, or null for the whole chain. */
export type Halt = { key: string; symbol: string | null; message: string; since: number };
/** What a user holds on this chain: positions by stock, and whether they lend USDC in the Earn vault. */
export type Holdings = { positions: { symbol: string; label: string }[]; lends: boolean };

const HALT_PREFIX = "halt:";

/**
 * The alert for a user hit by a halt: positions in the paused stock, or anything at all when it covers the whole chain.
 * Its key holds the gate and the start of the block, so a block that is lifted and comes back alerts again.
 */
export function haltAlert(h: Halt, held: Holdings, chainName: string): Omit<Alert, "address"> | null {
  const affected = [
    ...held.positions.filter((p) => h.symbol === null || p.symbol === h.symbol).map((p) => p.label),
    ...(h.symbol === null && held.lends ? ["USDC lent in Earn"] : []),
  ];
  if (affected.length === 0) return null;
  return {
    key: `${HALT_PREFIX}${h.key}:${h.since}`,
    subject: `Trading may be blocked on ${chainName}`,
    text: `${h.message}\n\nAffected: ${affected.join(", ")}.\n\nWe will send another message when it is lifted.`,
  };
}

/**
 * The follow-up for a halt alert already sent (`sentKey` without the chain id) whose block is no longer active.
 * `label` is the control as the monitor named it, without the effect sentence.
 */
export function liftedAlert(sentKey: string, active: Set<string>, label: string | undefined, chainName: string): Omit<Alert, "address"> | null {
  if (!sentKey.startsWith(HALT_PREFIX)) return null;
  const block = sentKey.slice(HALT_PREFIX.length);
  if (active.has(block)) return null;
  return {
    key: `lifted:${block}`,
    subject: `Block lifted on ${chainName}`,
    text: `${label ? `${label}: ` : ""}no longer blocking. If something else still blocks this market, you will have a separate message about it.`,
  };
}

type Settings = typeof alertSettings.$inferSelect;
type MarketView = { marketId: string; softLtvClosed: bigint };

export type AlertsOptions = {
  client: PublicClient;
  deployment: Deployment;
  channels: Channels;
  /** Only in the keeper with KEEPER_GLOBAL: Telegram allows one update reader per bot. */
  telegram?: TelegramSource;
  nextClose?: CloseSource;
  /** Unix seconds. The chain's clock unless a test sets another. */
  clock?: () => Promise<number>;
  intervalMs?: number;
};

/**
 * User alerts (BE-33): before-close warnings for positions above the closed limit, an LTV over the user's threshold,
 * auto-deleverage, liquidation and arrived deposits, for the positions on this keeper's chain. Each alert goes out once
 * per channel (`alert_deliveries`, keys start with the chain id); a failed send is removed again so the next run retries it.
 */
export function createAlerts({ client, deployment, channels, telegram, nextClose = closeFromCalendar, clock, intervalMs = 60_000 }: AlertsOptions): Job {
  const chainClock = async () => Number((await client.getBlock({ blockTag: "latest" })).timestamp);
  const symbols = new Map(deployment.markets.map((m) => [m.marketId.toLowerCase(), `${m.symbol} ${m.side}`]));
  const marketSymbols = new Map(deployment.markets.map((m) => [m.marketId.toLowerCase(), m.symbol as string]));

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
    async run({ db, chainId }) {
      const chainName = chains[chainId].name;
      const linked = telegram ? await linkTelegramChats(db, chainId, telegram) : 0;
      const now = await (clock ?? chainClock)();
      const users = (await db.select().from(alertSettings)).filter((s) => (s.email && channels.email) || (s.telegramChatId && channels.telegram));
      if (users.length === 0) return { linked, users: 0, sent: 0 };

      const markets: MarketView[] = (await client.readContract({ address: deployment.lens, abi: lensAbi, functionName: "getMarkets" })).map((m) => ({
        marketId: m.marketId.toLowerCase(),
        softLtvClosed: m.softLtvClosed,
      }));
      const closeAt = await nextClose(db, now, chainId);
      const stage = preCloseStage(now, closeAt);
      const since = new Date((now - EVENT_LOOKBACK_SECONDS) * 1000);
      const addresses = users.map((u) => u.address);
      const halts = await activeGates(db, chainId);
      const activeBlocks = new Set(halts.map((h) => `${h.key}:${h.since}`));
      const [haltsSent, gateRows] = await Promise.all([
        db
          .selectDistinct({ address: alertDeliveries.address, key: alertDeliveries.key })
          .from(alertDeliveries)
          .where(and(inArray(alertDeliveries.address, addresses), like(alertDeliveries.key, `${chainId}:halt:%`))),
        db
          .select({ key: monitorState.key, active: monitorState.active, message: monitorState.message })
          .from(monitorState)
          .where(and(eq(monitorState.chainId, chainId), like(monitorState.key, "gate:%"))),
      ]);
      const gateLabels = new Map(gateRows.map((r) => [r.key, r.message?.replace(` ${GATE_EFFECT}`, "").replace(/\.$/, "")]));
      // A control that cannot be read is not lifted: the block may still be there.
      const unread = new Set(gateRows.filter((r) => r.active && r.key.endsWith(":unread")).map((r) => r.key.slice(0, -":unread".length)));
      const [reduced, liquidated, arrived] = await Promise.all([
        db.select().from(routerEvents).where(and(eq(routerEvents.chainId, chainId), eq(routerEvents.name, "PositionReduced"), inArray(routerEvents.user, addresses), gte(routerEvents.blockTime, since))),
        db.select().from(morphoEvents).where(and(eq(morphoEvents.chainId, chainId), eq(morphoEvents.name, "Liquidate"), inArray(morphoEvents.user, addresses), gte(morphoEvents.blockTime, since))),
        db.select().from(deposits).where(and(eq(deposits.chainId, chainId), eq(deposits.kind, "deposit"), eq(deposits.status, "SUCCESS"), inArray(deposits.user, addresses), gte(deposits.updatedAt, since))),
      ]);

      let sent = 0;
      let failed = 0;
      const send = async (s: Settings, alert: Omit<Alert, "address">) => {
        const r = await deliver(db, s, { ...alert, key: `${chainId}:${alert.key}`, address: s.address });
        sent += r.sent;
        failed += r.failed;
      };

      for (const s of users) {
        const all = (await client.readContract({ address: deployment.lens, abi: lensAbi, functionName: "getPositions", args: [getAddress(s.address)] })).filter((p) =>
          symbols.has(p.marketId.toLowerCase()),
        );
        const positions = all.filter((p) => p.debt > 0n);

        // Halts (BE-75): sent to everyone with alerts set up, with no setting to turn them off, since a halt can stop a close.
        if (halts.length > 0) {
          const wholeChain = halts.some((h) => h.symbol === null);
          const lends =
            wholeChain && deployment.usdcVault
              ? (await client.readContract({ address: deployment.usdcVault, abi: erc20Abi, functionName: "balanceOf", args: [getAddress(s.address)] })) > 0n
              : false;
          const held: Holdings = {
            positions: all
              .filter((p) => p.collateral > 0n || p.debt > 0n)
              .map((p) => ({ symbol: marketSymbols.get(p.marketId.toLowerCase())!, label: symbols.get(p.marketId.toLowerCase())! })),
            lends,
          };
          for (const h of halts) {
            const alert = haltAlert(h, held, chainName);
            if (alert) await send(s, alert);
          }
        }
        for (const sentRow of haltsSent.filter((r) => r.address === s.address)) {
          const sentKey = sentRow.key.slice(`${chainId}:`.length);
          const gateKey = sentKey.slice(HALT_PREFIX.length, sentKey.lastIndexOf(":"));
          if (unread.has(gateKey)) continue;
          const alert = liftedAlert(sentKey, activeBlocks, gateLabels.get(gateKey) ?? undefined, chainName);
          if (alert) await send(s, alert);
        }

        if (s.preClose && stage !== null) {
          const atRisk = positions.filter((p) => p.ltv > (markets.find((m) => m.marketId === p.marketId.toLowerCase())?.softLtvClosed ?? 0n));
          if (atRisk.length > 0) {
            const lines = atRisk.map((p) => {
              const closed = markets.find((m) => m.marketId === p.marketId.toLowerCase())!.softLtvClosed;
              return `${symbols.get(p.marketId.toLowerCase())}: LTV ${pct(p.ltv)}, closed-market limit ${pct(closed)}${p.protection ? " (protection on: it will be reduced 30 minutes before the close)" : ""}`;
            });
            await send(s, {
              key: `preclose:${closeAt}:${stage}`,
              subject: `The ${chainName} market closes in ${hours(stage)}`,
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
              await db.delete(alertDeliveries).where(and(eq(alertDeliveries.address, s.address), eq(alertDeliveries.key, `${chainId}:${key}`)));
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
            await send(s, { key: `deposit:${d.id}`, subject: "Deposit arrived", text: `Your deposit arrived on ${chainName}${d.destinationTxHash ? `. Transaction: ${d.destinationTxHash}` : "."}` });
          }
        }
      }

      if (failed > 0) throw new Error(`${failed} alert(s) could not be sent; they will be retried`);
      return { linked, users: users.length, closeAt, stage, sent };
    },
  };
}
