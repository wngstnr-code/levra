import { observedClosedStretches, type Db } from "@levra/db";
import { riskManagerAbi } from "@levra/shared/abis";
import { nextCloseAfter, scheduleFromStretches, type SessionSchedule } from "@levra/shared/calendar";
import type { Deployment } from "@levra/shared/deployments";
import { parseAbi, type Account, type Chain, type PublicClient, type Transport, type WalletClient } from "viem";
import type { Job } from "../runner";

/** RiskManager: MAX_CLOSE_HORIZON and CLOSE_GRACE, in seconds. */
const MAX_CLOSE_HORIZON = 8 * 86_400;
const CLOSE_GRACE = 3_600;
/** `RiskManager.calendarPoster()`. Temporary until the ABI export has it (requested from Wangsit). */
const calendarPosterAbi = parseAbi(["function calendarPoster() view returns (address)"]);
/** Monad charges the gas limit (02), so the margin over the estimate stays small. */
const GAS_MARGIN_PCT = 15n;

export type CloseDecision = { action: "post"; value: number; reason: string } | { action: "skip"; reason: string };

/**
 * What to post, from the close on chain and the next close by the calendar. Unix seconds. A close that has just passed
 * stays on chain through the contract's grace hour, so the closed regime does not end early.
 */
export function decideNextClose(p: { now: number; current: number; next: number }): CloseDecision {
  if (p.current !== 0 && p.current <= p.now && p.now < p.current + CLOSE_GRACE) {
    return { action: "skip", reason: `the close at ${p.current} passed less than an hour ago` };
  }
  if (p.next === p.current) return { action: "skip", reason: `${p.current} on chain is the next close` };
  if (p.next > p.now + MAX_CLOSE_HORIZON) return { action: "skip", reason: `the next close at ${p.next} is beyond the contract's 8-day horizon` };
  return { action: "post", value: p.next, reason: p.current > p.now ? `corrected from ${p.current}` : "the previous close passed" };
}

export type ScheduleSource = (db: Db) => Promise<SessionSchedule>;

/** The Anchored schedule from the weekends and holidays in the oracle logger data; the regular close until one is seen. */
export const scheduleFromLogger: ScheduleSource = async (db) => scheduleFromStretches(await observedClosedStretches(db));

export type CalendarPosterOptions = {
  client: PublicClient;
  wallet: WalletClient<Transport, Chain, Account>;
  deployment: Deployment;
  schedule?: ScheduleSource;
  intervalMs?: number;
};

/**
 * Keeps `nextCloseAt` on `RiskManager` at the next close of the Anchored session (BE-30). The time comes from the
 * exchange calendar and the observed schedule, never from a table in the code. Uses the chain's clock.
 */
export function createCalendarPoster({ client, wallet, deployment, schedule = scheduleFromLogger, intervalMs = 600_000 }: CalendarPosterOptions): Job {
  return {
    name: "calendar",
    intervalMs,
    async run({ db, logger }) {
      const poster = await client.readContract({ address: deployment.riskManager, abi: calendarPosterAbi, functionName: "calendarPoster" });
      if (poster.toLowerCase() !== wallet.account.address.toLowerCase()) {
        throw new Error(`Key ${wallet.account.address} is not the calendar poster (${poster})`);
      }
      const [block, current, sched] = await Promise.all([
        client.getBlock({ blockTag: "latest" }),
        client.readContract({ address: deployment.riskManager, abi: riskManagerAbi, functionName: "nextCloseAt" }),
        schedule(db),
      ]);
      const now = Number(block.timestamp);
      const next = nextCloseAfter(now, sched);
      const decision = decideNextClose({ now, current: Number(current), next });
      const entry = { now, current: Number(current), next, schedule: sched, ...decision };
      if (decision.action === "skip") return entry;

      const request = { address: deployment.riskManager, abi: riskManagerAbi, functionName: "setNextCloseAt", args: [BigInt(decision.value)] } as const;
      const gas = await client.estimateContractGas({ ...request, account: wallet.account });
      const hash = await wallet.writeContract({ ...request, gas: gas + (gas * GAS_MARGIN_PCT) / 100n });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`setNextCloseAt reverted: ${hash}`);
      logger.info({ ...entry, tx: hash }, "nextCloseAt posted");
      return { ...entry, tx: hash };
    },
  };
}
