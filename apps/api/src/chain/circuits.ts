import { xlayerTapeout } from "@levra/shared/addresses";
import type { ClockCheck, GapCheck, RiskCheck, SessionName } from "@levra/shared/api";
import { BPS, cautiousPriceE8, collateralValue, morphoOraclePrice, mulDiv } from "@levra/shared/math";
import {
  MAX_RISK_AMOUNT,
  circuitsAbi,
  clockAt,
  clockInput,
  evalCircuit,
  readClockOutput,
  readRiskOutput,
  riskAt,
  riskCircuit,
  riskInput,
  type RiskLimits,
  type RiskPosition,
} from "@levra/tapeout";
import { keccak256, type Address, type Hex, type PublicClient } from "viem";
import type { MarketState } from "./reader";

/** Initial proposal: a circuit answer is extra, so a slow `eval` must not hold up the account or the quote. */
export const EVAL_TIMEOUT_MS = 5_000;
/** The years built into circuit 1 (05, BE-82). */
const CLOCK_FROM = 2026;
const CLOCK_TO = 2030;
const OPEN_SESSIONS: readonly SessionName[] = ["PRE_MARKET", "REGULAR", "POST_MARKET", "OVERNIGHT"];

export type Circuits = ReturnType<typeof createCircuits>;

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no circuit answer in ${ms} ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

const limitsOf = (m: MarketState): RiskLimits => ({ lltvWad: m.lltvWad, softOpenWad: m.softLtvOpenWad, softClosedWad: m.softLtvClosedWad });

/**
 * The circuit inputs for a position in loan token units, the way Morpho counts them: debt, and the collateral's value at
 * the Morpho price (USDC for a long, stock for a short). Null without a price.
 */
export function positionAmounts(m: MarketState, collateralRaw: bigint, debtRaw: bigint, usdcDecimals: number): { debt: bigint; value: bigint } | null {
  if (m.oraclePriceE8 === 0n) return null;
  const side = m.info.side;
  const price = morphoOraclePrice(side, cautiousPriceE8(side, { priceE8: m.oraclePriceE8, bidE8: m.bidE8, askE8: m.askE8 }), m.info.stock.decimals, usdcDecimals);
  return { debt: debtRaw, value: collateralValue(collateralRaw, price) };
}

/**
 * The collateral value after the stock moves by `moveBps` (04 gap rule): a long's stock collateral moves with the price;
 * a short's USDC collateral buys `1 / (1 + move)` as much stock. Rounded down, as Morpho rounds a value.
 */
export function valueAfterGap(side: "long" | "short", value: bigint, moveBps: number): bigint {
  const factor = BPS + BigInt(moveBps);
  if (factor <= 0n) return side === "long" ? 0n : value;
  return side === "long" ? mulDiv(value, factor, BPS) : mulDiv(value, BPS, factor);
}

/** The circuit session inputs that give the market's current closed regime: the pre-close window shows as the flag. */
export function sessionInputs(m: MarketState): Pick<RiskPosition, "session" | "preClose"> {
  const open = OPEN_SESSIONS.includes(m.session);
  return { session: m.session, preClose: open && m.currentSoftLtvWad !== m.softLtvOpenWad };
}

/**
 * Levra's TapeOut circuits on X Layer (BE-83, BE-86). A risk circuit is used for a market only when its netlist onchain is
 * byte for byte the circuit built from the market's limits as read on chain now, so a limit change can never be answered
 * by a circuit for the old limits. Each answer is compared with the API's own rules (`riskAt`, `clockAt`). Any failure
 * gives null: the circuit is extra and never stands in for the API's numbers.
 */
export function createCircuits(client: PublicClient, opts: { timeoutMs?: number } = {}) {
  const timeoutMs = opts.timeoutMs ?? EVAL_TIMEOUT_MS;
  const processor = xlayerTapeout.processor as Address;
  const riskIds = [xlayerTapeout.circuits.risk77, xlayerTapeout.circuits.risk62_5];

  let netlists: Promise<Map<Hex, number>> | null = null;
  const onchainNetlists = () => {
    if (!netlists) {
      const read = Promise.all(
        riskIds.map(async (id) => [keccak256(await client.readContract({ address: processor, abi: circuitsAbi, functionName: "netlist", args: [BigInt(id)] })), id] as const),
      ).then((pairs) => new Map(pairs));
      read.catch(() => (netlists = null));
      netlists = read;
    }
    return netlists;
  };

  const byLimits = new Map<string, Promise<number | null>>();
  const circuitFor = (limits: RiskLimits) => {
    const key = `${limits.lltvWad}:${limits.softOpenWad}:${limits.softClosedWad}`;
    let hit = byLimits.get(key);
    if (!hit) {
      hit = onchainNetlists().then((map) => map.get(keccak256(riskCircuit(limits).netlist)) ?? null);
      hit.catch(() => byLimits.delete(key));
      byLimits.set(key, hit);
    }
    return hit;
  };

  async function evalRisk(limits: RiskLimits, p: RiskPosition) {
    if (p.debt > MAX_RISK_AMOUNT || p.value > MAX_RISK_AMOUNT) return null;
    const id = await circuitFor(limits);
    if (id === null) return null;
    const reading = readRiskOutput(await evalCircuit(client, processor, BigInt(id), riskInput(p)));
    return { circuitId: id, reading, expected: riskAt(limits, p) };
  }

  const clockAnswers = new Map<number, Promise<ClockCheck | null>>();

  return {
    processor,

    async risk(m: MarketState, amounts: { debt: bigint; value: bigint } | null): Promise<RiskCheck | null> {
      if (!amounts) return null;
      try {
        const r = await withTimeout(evalRisk(limitsOf(m), { ...amounts, ...sessionInputs(m) }), timeoutMs);
        if (!r) return null;
        const { reading, expected } = r;
        return {
          processor,
          circuitId: r.circuitId,
          healthy: reading.healthy,
          belowSoftLimit: reading.belowSoft,
          matches: reading.healthy === expected.healthy && reading.belowSoft === expected.belowSoft,
        };
      } catch {
        return null;
      }
    },

    async gap(m: MarketState, amounts: { debt: bigint; value: bigint } | null, moveBps: number | undefined): Promise<GapCheck | null> {
      if (!amounts || moveBps === undefined) return null;
      try {
        const after = { debt: amounts.debt, value: valueAfterGap(m.info.side, amounts.value, moveBps), ...sessionInputs(m) };
        const r = await withTimeout(evalRisk(limitsOf(m), after), timeoutMs);
        if (!r) return null;
        return { processor, circuitId: r.circuitId, moveBps, healthyAfterGap: r.reading.healthy, matches: r.reading.healthy === r.expected.healthy };
      } catch {
        return null;
      }
    },

    /** The circuit reads minutes, so one answer per minute is kept; a failed read is asked again next time. */
    clock(unix: number): Promise<ClockCheck | null> {
      const minute = Math.floor(unix / 60) * 60;
      let hit = clockAnswers.get(minute);
      if (!hit) {
        if (clockAnswers.size > 60) clockAnswers.clear();
        hit = withTimeout(evalCircuit(client, processor, BigInt(xlayerTapeout.circuits.wallStreetClock), clockInput(minute)), timeoutMs)
          .then((out) => {
            const c = readClockOutput(out);
            const want = clockAt(minute, CLOCK_FROM, CLOCK_TO);
            const matches = c.session === want.session && c.holiday === want.holiday && c.weekend === want.weekend && c.earlyClose === want.earlyClose;
            return { processor, circuitId: xlayerTapeout.circuits.wallStreetClock, ...c, matches };
          })
          .catch(() => {
            clockAnswers.delete(minute);
            return null;
          });
        clockAnswers.set(minute, hit);
      }
      return hit;
    },
  };
}
