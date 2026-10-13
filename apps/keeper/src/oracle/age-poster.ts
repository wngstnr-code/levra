import { riskManagerAbi } from "@levra/shared/abis";
import type { Deployment } from "@levra/shared/deployments";
import type { Db } from "@levra/db";
import type { Account, Chain, PublicClient, Transport, WalletClient } from "viem";
import type { Job } from "../runner";
import type { MaxAgeProposal } from "./max-age";
import { loadOracleReport } from "./report";

/** Smallest change worth posting, as a share of the value on chain (04): 10%. */
const MIN_CHANGE_DIVISOR = 10;
/** Monad charges the gas limit (02), so the margin over the estimate stays small. */
const GAS_MARGIN_PCT = 15n;

export type AgeDecision = { action: "post"; value: number; reason: string } | { action: "skip"; reason: string };

/** What to do for one market, from the data-based proposal and the chain values. All values in seconds. */
export function decideMaxOracleAge(p: { proposal: MaxAgeProposal; current: number; min: number; cap: number }): AgeDecision {
  if (p.cap === 0) return { action: "skip", reason: "the owner has set no bounds for this market" };
  if (p.proposal.value === null) return { action: "skip", reason: p.proposal.reason };
  const value = Math.min(Math.max(p.proposal.value, p.min), p.cap);
  const clamped = value !== p.proposal.value ? ` (data gave ${p.proposal.value}, kept inside ${p.min} to ${p.cap})` : "";
  if (Math.abs(value - p.current) * MIN_CHANGE_DIVISOR < p.current) {
    return { action: "skip", reason: `${value} is within 10% of ${p.current} on chain${clamped}` };
  }
  return { action: "post", value, reason: `from ${p.current} to ${value}${clamped}` };
}

export type ProposalSource = (db: Db) => Promise<Map<string, MaxAgeProposal>>;

/** Proposals per stock symbol from the oracle logger tables, with the rule in 04. */
export const proposalsFromLogger: ProposalSource = async (db) =>
  new Map((await loadOracleReport(db)).maxAge.map(({ symbol, proposal }) => [symbol, proposal]));

export type OracleAgePosterOptions = {
  client: PublicClient;
  wallet: WalletClient<Transport, Chain, Account>;
  deployment: Deployment;
  proposals?: ProposalSource;
  intervalMs?: number;
};

/**
 * Keeps `maxOracleAge` of every market in line with the oracle data (BE-17, D-31). Only moves it inside the bounds the
 * owner set; the contract rejects anything else. Long and short markets of a stock share one oracle, so they get the same value.
 */
export function createOracleAgePoster({ client, wallet, deployment, proposals = proposalsFromLogger, intervalMs = 3_600_000 }: OracleAgePosterOptions): Job {
  return {
    name: "oracleAgePoster",
    intervalMs,
    async run({ db, logger }) {
      const poster = await client.readContract({ address: deployment.riskManager, abi: riskManagerAbi, functionName: "oracleAgePoster" });
      if (poster.toLowerCase() !== wallet.account.address.toLowerCase()) {
        throw new Error(`Key ${wallet.account.address} is not the oracle age poster (${poster})`);
      }
      const bySymbol = await proposals(db);
      const results: Record<string, unknown>[] = [];

      for (const market of deployment.markets) {
        const [config, bounds] = await Promise.all([
          client.readContract({ address: deployment.riskManager, abi: riskManagerAbi, functionName: "config", args: [market.marketId] }),
          client.readContract({ address: deployment.riskManager, abi: riskManagerAbi, functionName: "oracleAgeBounds", args: [market.marketId] }),
        ]);
        const [min, cap] = bounds;
        const proposal = bySymbol.get(market.symbol) ?? { value: null, reason: "no oracle data for this stock" };
        const decision = decideMaxOracleAge({ proposal, current: config.maxOracleAge, min, cap });
        const entry = { symbol: market.symbol, side: market.side, current: config.maxOracleAge, min, cap, proposal: proposal.value, ...decision };

        if (decision.action === "post") {
          const request = { address: deployment.riskManager, abi: riskManagerAbi, functionName: "setMaxOracleAge", args: [market.marketId, decision.value] } as const;
          const gas = await client.estimateContractGas({ ...request, account: wallet.account });
          const hash = await wallet.writeContract({ ...request, gas: gas + (gas * GAS_MARGIN_PCT) / 100n });
          const receipt = await client.waitForTransactionReceipt({ hash });
          if (receipt.status !== "success") throw new Error(`setMaxOracleAge reverted for ${market.symbol} ${market.side}: ${hash}`);
          logger.warn({ ...entry, tx: hash }, "maxOracleAge changed");
          results.push({ ...entry, tx: hash });
        } else {
          results.push(entry);
        }
      }
      return { markets: results };
    },
  };
}
