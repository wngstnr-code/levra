import type { AgentCircuitCheck, PrepareRequest } from "@levra/shared/api";
import { WAD } from "@levra/shared/math";
import { z } from "zod";
import { EVAL_TIMEOUT_MS, positionAmounts, withTimeout } from "./circuits";
import type { ChainReader } from "./reader";

/** Only the quote fields the check uses; the quote routes check the full shapes. */
const openQuote = z.object({
  market: z.object({ marketId: z.string() }),
  preview: z.object({ collateralRaw: z.string(), debtRaw: z.string(), circuitGapCheck: z.unknown().optional() }),
});
const closeQuote = z.object({ preview: z.object({ collateralWithdrawnRaw: z.string(), debtRepaidRaw: z.string() }) });
const collateralQuote = z.object({ preview: z.object({ collateralAfterRaw: z.string() }) });

const floor0 = (v: bigint) => (v < 0n ? 0n : v);

/**
 * The position after a prepared action, in Morpho units, from the quote made now: an open's preview already holds the
 * position after it; a partial close and a collateral action start from the position read now. Null after a full close
 * (nothing is left to check) or when there is no position to start from.
 */
export async function positionAfter(reader: ChainReader, action: PrepareRequest, quote: unknown): Promise<{ marketId: string; collateral: bigint; debt: bigint } | null> {
  if (action.kind === "open") {
    const q = openQuote.parse(quote);
    return { marketId: q.market.marketId, collateral: BigInt(q.preview.collateralRaw), debt: BigInt(q.preview.debtRaw) };
  }
  const { marketId, user } = action.request;
  if (action.kind === "close" && BigInt(action.request.fractionWad) >= WAD) return null;
  const pos = (await reader.positions(user, { fresh: true })).find((p) => p.marketId.toLowerCase() === marketId.toLowerCase());
  if (!pos) return null;
  if (action.kind === "close") {
    const q = closeQuote.parse(quote);
    return { marketId, collateral: floor0(pos.collateralRaw - BigInt(q.preview.collateralWithdrawnRaw)), debt: floor0(pos.debtRaw - BigInt(q.preview.debtRepaidRaw)) };
  }
  const q = collateralQuote.parse(quote);
  const debt = action.request.action === "repay" ? floor0(pos.debtRaw - BigInt(action.request.amountRaw)) : pos.debtRaw;
  return { marketId, collateral: BigInt(q.preview.collateralAfterRaw), debt };
}

/**
 * BE-87: what the TapeOut circuits say about a prepared action on X Layer. Each part is null when its circuit gives no
 * answer, and a failed read of the chain gives null for the whole check: it never stops the action being prepared.
 */
export async function actionCircuitCheck(reader: ChainReader, action: PrepareRequest, quote: unknown, nowMs: number, timeoutMs = 2 * EVAL_TIMEOUT_MS): Promise<AgentCircuitCheck | null> {
  const circuits = reader.circuits;
  if (!circuits) return null;
  const check = async (): Promise<AgentCircuitCheck> => {
    const clock = circuits.clock(Math.floor(nowMs / 1000));
    const after = await positionAfter(reader, action, quote);
    const m = after && (await reader.markets()).find((x) => x.info.marketId.toLowerCase() === after.marketId.toLowerCase());
    const risk = m && after ? await circuits.risk(m, positionAmounts(m, after.collateral, after.debt, reader.usdc.decimals)) : null;
    const gap = action.kind === "open" ? ((openQuote.parse(quote).preview.circuitGapCheck ?? null) as AgentCircuitCheck["gap"]) : null;
    return { risk, gap, clock: await clock };
  };
  try {
    // The chain reads before the circuit's own timeout get one more: the check must never hold up preparing a close.
    return await withTimeout(check(), timeoutMs);
  } catch {
    return null;
  }
}
