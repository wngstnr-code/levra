import { riskManagerAbi } from "@levra/shared/abis";
import { etToUnix } from "@levra/shared/calendar";
import type { Deployment } from "@levra/shared/deployments";
import { erc20Abi, stringToHex, type Address, type Hex, type PublicClient } from "viem";
import {
  circuitsAbi,
  createProcessor,
  endpointId,
  evalCircuit,
  factoryAbi,
  hubAbi,
  mintNand,
  openContainer,
  openerAbi,
  sendMessage,
  tapeout,
  transistorsAbi,
  type TapeOutClients,
  type TapeOutContracts,
} from "./chain";
import { clockAt, clockInput, readClockOutput, wallStreetClock } from "./clock";
import { readRiskOutput, riskAt, riskCircuit, riskInput, type RiskLimits, type RiskPosition } from "./risk";

/**
 * The TapeOut run on a live chain (BE-82, BE-83, BE-86, D-113): one processor, the Wall Street Clock and one risk
 * circuit per limit set of the deployment, each read back with `eval`, one open container, one TapeSend message.
 * Every finished step is saved, so a second run goes on where the first stopped and never pays for a step twice.
 */

export const CLOCK_YEARS = [2026, 2030] as const;

export const LEVRA_PROCESSOR = {
  name: "Levra",
  symbol: "LEVRA",
  story: "Levra on X Layer: the Wall Street Clock that sets its market hours and the risk circuits that check every trade before it is signed (D-113).",
  // The three circuits take about 21,000 NAND; the rest covers the plain Morpho LLTV circuits of BE-83. All minted to us.
  supply: 60_000n,
};

export type CircuitPlan = {
  key: string;
  label: string;
  circuit: { gates: unknown[]; nIn: number; nOut: number; netlist: Hex };
  /** Reads the taped out circuit and throws when it disagrees with `calendar.ts` or `math.ts`. */
  check: (client: PublicClient, circuits: Address, id: bigint) => Promise<number>;
};

export type RunState = {
  chainId: number;
  signer: Address;
  processor?: { circuits: Address; transistors: Address; hash: Hex };
  mint?: { amount: string; hash: Hex };
  circuits: Record<string, { label: string; id: string; gateCount: number; hash: Hex; checked?: number }>;
  container?: { circuit: string; address: Address; hash: Hex };
  message?: { hash: Hex; inboxIndex: string };
  /** Set before each transaction and cleared after its result is saved: a crash in between stops the next run. */
  pending?: { step: string; nonce: number };
};

export type RunOptions = {
  contracts: TapeOutContracts;
  deployment: Deployment;
  processor: { name: string; symbol: string; story: string; supply: bigint };
  save: (state: RunState) => void;
  log: (line: string) => void;
};

const bps = (wad: bigint) => (wad * 10_000n) / 10n ** 18n;
const pct = (wad: bigint) => `${Number(bps(wad)) / 100}%`;

/** One risk circuit per distinct (LLTV, soft open, soft closed) of the deployment's markets, read from its RiskManager. */
export async function riskPlans(client: PublicClient, deployment: Deployment): Promise<CircuitPlan[]> {
  const sets = new Map<string, { limits: Required<RiskLimits>; markets: string[] }>();
  for (const m of deployment.markets) {
    const config = await client.readContract({ address: deployment.riskManager, abi: riskManagerAbi, functionName: "config", args: [m.marketId] });
    if (!config.enabled) continue;
    const limits = { lltvWad: BigInt(m.lltv), softOpenWad: config.softLtvOpen, softClosedWad: config.softLtvClosed };
    const key = `risk-${bps(limits.lltvWad)}-${bps(limits.softOpenWad)}-${bps(limits.softClosedWad)}`;
    const set = sets.get(key) ?? { limits, markets: [] };
    set.markets.push(`${m.symbol} ${m.side}`);
    sets.set(key, set);
  }
  return [...sets].map(([key, { limits, markets }]) => ({
    key,
    label: `risk ${pct(limits.lltvWad)} / ${pct(limits.softOpenWad)} / ${pct(limits.softClosedWad)} (${markets.join(", ")})`,
    circuit: riskCircuit(limits),
    check: async (client, circuits, id) => {
      const positions = riskSamples(limits);
      for (const p of positions) {
        const got = readRiskOutput(await evalCircuit(client, circuits, id, riskInput(p)));
        const want = riskAt(limits, p);
        if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${key} disagrees with math.ts at debt ${p.debt}, value ${p.value}, ${p.session}`);
      }
      return positions.length;
    },
  }));
}

/** Positions exactly on each limit and one unit either side, in every regime, plus the empty and the bad debt case. */
export function riskSamples(limits: Required<RiskLimits>): RiskPosition[] {
  const value = 1_234_567_890_123n;
  const out: RiskPosition[] = [
    { debt: 0n, value: 0n, session: "REGULAR", preClose: false },
    { debt: 5n, value: 0n, session: "PRE_MARKET", preClose: false },
  ];
  for (const t of [limits.lltvWad, limits.softOpenWad, limits.softClosedWad]) {
    const on = (value * t) / 10n ** 18n;
    out.push({ debt: on, value, session: "REGULAR", preClose: false });
    out.push({ debt: on + 1n, value, session: "CLOSED", preClose: false });
    out.push({ debt: on - 1n, value, session: "OVERNIGHT", preClose: true });
    out.push({ debt: on, value, session: "UNKNOWN", preClose: false });
  }
  return out;
}

/** Moments around the regular session, a holiday, an early close, a weekend, daylight saving and outside 2026 to 2030. */
export function clockSamples(): number[] {
  const et = (date: string, h: number, m = 0) => etToUnix(date, h * 3600 + m * 60);
  return [
    et("2026-11-23", 10),
    et("2026-11-23", 3, 59),
    et("2026-11-23", 16, 30),
    et("2026-11-26", 12),
    et("2026-11-27", 13),
    et("2026-11-29", 20),
    et("2027-03-14", 9, 30),
    et("2028-07-04", 11),
    et("2025-12-31", 12),
  ];
}

export function clockPlan(): CircuitPlan {
  const [from, to] = CLOCK_YEARS;
  return {
    key: `clock-${from}-${to}`,
    label: `Wall Street Clock ${from} to ${to}`,
    circuit: wallStreetClock(from, to),
    check: async (client, circuits, id) => {
      const moments = clockSamples();
      for (const unix of moments) {
        const got = readClockOutput(await evalCircuit(client, circuits, id, clockInput(unix)));
        const want = clockAt(unix, from, to);
        if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`clock disagrees with calendar.ts at ${new Date(unix * 1000).toISOString()}`);
      }
      return moments.length;
    },
  };
}

export async function planCircuits(client: PublicClient, deployment: Deployment): Promise<CircuitPlan[]> {
  return [clockPlan(), ...(await riskPlans(client, deployment))];
}

/** Gas per gate measured by Cerebr (05), with a margin: a tape out is about 210,000 gas plus 2,900 per gate. */
const tapeoutGas = (gates: number) => 300_000n + 3_200n * BigInt(gates);
const FIXED_GAS = 2_000_000n;

export type Quote = {
  signer: Address;
  gates: number;
  supply: bigint;
  bem: { need: bigint; have: bigint; decimals: 8 };
  okb: { need: bigint; have: bigint };
  fees: { deploy: bigint; protocol: bigint; tapeout: bigint; open: bigint; gasPrice: bigint };
};

/** What the remaining steps cost and what the signer holds. Every fee is read live: the factory is upgradeable. */
export async function quoteRun(client: PublicClient, opts: Pick<RunOptions, "contracts" | "processor">, plans: CircuitPlan[], state: RunState): Promise<Quote> {
  const { factory, opener } = opts.contracts;
  const signer = state.signer;
  const [deploy, protocol, bemToken, open, gasPrice, okbHave] = await Promise.all([
    client.readContract({ address: factory, abi: factoryAbi, functionName: "deployFee" }),
    client.readContract({ address: factory, abi: factoryAbi, functionName: "protocolFee" }),
    client.readContract({ address: factory, abi: factoryAbi, functionName: "bem" }),
    client.readContract({ address: opener, abi: openerAbi, functionName: "FEE" }),
    client.getGasPrice(),
    client.getBalance({ address: signer }),
  ]);
  // Every processor uses the same circuits contract code, so the fee of a live one stands in until ours exists.
  const tapeoutFee = state.processor ? await client.readContract({ address: state.processor.circuits, abi: circuitsAbi, functionName: "TAPEOUT_FEE" }) : 1_300_000_000_000_000n;
  const bemHave = await client.readContract({ address: bemToken, abi: erc20Abi, functionName: "balanceOf", args: [signer] });
  const todo = plans.filter((p) => !state.circuits[p.key]);
  const gates = plans.reduce((n, p) => n + p.circuit.gates.length, 0);
  const bemNeed = (state.processor ? 0n : deploy) + (state.mint ? 0n : protocol);
  const gas = FIXED_GAS + todo.reduce((g, p) => g + tapeoutGas(p.circuit.gates.length), 0n);
  const okbNeed = BigInt(todo.length) * tapeoutFee + (state.container ? 0n : open) + (gas * gasPrice * 3n) / 2n;
  return {
    signer,
    gates,
    supply: opts.processor.supply,
    bem: { need: bemNeed, have: bemHave, decimals: 8 },
    okb: { need: okbNeed, have: okbHave },
    fees: { deploy, protocol, tapeout: tapeoutFee, open, gasPrice },
  };
}

/** Runs the steps not done yet, saving the state after each one. */
export async function runTapeOut(clients: TapeOutClients, opts: RunOptions, plans: CircuitPlan[], state: RunState): Promise<RunState> {
  const { client, wallet } = clients;
  const { contracts, log } = opts;
  const signer = wallet.account.address;
  if (signer.toLowerCase() !== state.signer.toLowerCase()) throw new Error(`the state file belongs to ${state.signer}, not ${signer}`);
  const chainId = await client.getChainId();
  if (chainId !== state.chainId) throw new Error(`the state file is for chain ${state.chainId}, the RPC serves ${chainId}`);

  const step = async <T>(name: string, run: () => Promise<T>, done: (result: T) => void) => {
    const nonce = await client.getTransactionCount({ address: signer, blockTag: "pending" });
    if (state.pending) {
      if (nonce !== state.pending.nonce) {
        throw new Error(
          `"${state.pending.step}" was sent (nonce ${state.pending.nonce}) but its result was not saved. Look up ${signer} on the explorer, ` +
            "write the result into the state file and remove `pending` before running again.",
        );
      }
      log(`"${state.pending.step}" left nothing onchain, trying again`);
    }
    state.pending = { step: name, nonce };
    opts.save(state);
    const result = await run();
    done(result);
    delete state.pending;
    opts.save(state);
  };

  if (!state.processor) {
    const p = opts.processor;
    await step(
      "createCPU",
      () => createProcessor(clients, contracts.factory, { name: p.name, symbol: p.symbol, story: p.story, supply: p.supply, mintPrice: 0n }),
      (r) => {
        state.processor = { circuits: r.circuits, transistors: r.transistors, hash: r.hash };
        log(`processor ${r.circuits}, transistors ${r.transistors} (${r.hash})`);
      },
    );
  }
  const { circuits, transistors } = state.processor!;

  if (!state.mint) {
    // The whole supply in one call: the protocol fee is per call, and nobody else can take transistors we need later.
    const [cap, minted] = await Promise.all([
      client.readContract({ address: transistors, abi: transistorsAbi, functionName: "supplyCap" }),
      client.readContract({ address: transistors, abi: transistorsAbi, functionName: "minted" }),
    ]);
    const amount = cap - minted;
    const needed = plans.reduce((n, p) => n + BigInt(p.circuit.gates.length), 0n);
    if (amount < needed) throw new Error(`only ${amount} transistors are left and the circuits need ${needed}`);
    await step(
      "mint",
      () => mintNand(clients, contracts.factory, transistors, amount),
      (r) => {
        state.mint = { amount: amount.toString(), hash: r.hash };
        log(`minted ${amount} NAND (${r.hash})`);
      },
    );
  }

  for (const plan of plans) {
    if (state.circuits[plan.key]) continue;
    await step(
      `tapeout ${plan.key}`,
      () => tapeout(clients, circuits, plan.circuit),
      (r) => {
        if (r.gateCount !== plan.circuit.gates.length) throw new Error(`${plan.key}: ${r.gateCount} gates onchain, ${plan.circuit.gates.length} built`);
        state.circuits[plan.key] = { label: plan.label, id: r.id.toString(), gateCount: r.gateCount, hash: r.hash };
        log(`${plan.label}: circuit ${r.id}, ${r.gateCount} NAND, ${r.gasUsed} gas (${r.hash})`);
      },
    );
  }

  for (const plan of plans) {
    const done = state.circuits[plan.key]!;
    if (done.checked) continue;
    done.checked = await plan.check(client, circuits, BigInt(done.id));
    opts.save(state);
    log(`${plan.label}: ${done.checked} readings match`);
  }

  const first = plans[0]!;
  if (!state.container) {
    const id = BigInt(state.circuits[first.key]!.id);
    await step(
      `open ${first.key}`,
      () => openContainer(clients, contracts.opener, circuits, id),
      (r) => {
        state.container = { circuit: first.key, address: r.container, hash: r.hash };
        log(`container ${r.container} of ${first.label} (${r.hash})`);
      },
    );
  }

  if (!state.message) {
    const id = BigInt(state.circuits[state.container!.circuit]!.id);
    const to = endpointId(state.chainId, state.container!.address);
    const payload = stringToHex(JSON.stringify({ v: 1, kind: "levra-hello", processor: circuits, circuit: id.toString() }));
    await step(
      "send",
      () => sendMessage(clients, contracts.hub, { circuits, id, to, payload }),
      (r) => {
        state.message = { hash: r.hash, inboxIndex: r.inboxIndex.toString() };
        log(`TapeSend message ${r.inboxIndex} from ${r.from} (${r.hash})`);
      },
    );
  }

  const owner = await client.readContract({ address: circuits, abi: circuitsAbi, functionName: "ownerOf", args: [BigInt(state.circuits[first.key]!.id)] });
  const inbox = await client.readContract({ address: contracts.hub, abi: hubAbi, functionName: "inboxCount", args: [endpointId(state.chainId, state.container!.address)] });
  log(`done: ${owner} holds the circuit NFTs, the container inbox has ${inbox} message(s)`);
  return state;
}
