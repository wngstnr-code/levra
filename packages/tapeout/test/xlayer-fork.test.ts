import { etToUnix } from "@levra/shared/calendar";
import { xlayerExternal } from "@levra/shared/addresses";
import { createPublicClient, createWalletClient, encodeFunctionData, erc20Abi, getAddress, http, stringToHex, toHex, type Address, type Hex } from "viem";
import { xLayer } from "viem/chains";
import { beforeAll, describe, expect, it } from "vitest";
import {
  circuitsAbi,
  clockAt,
  clockInput,
  createProcessor,
  endpointId,
  evalCircuit,
  factoryAbi,
  hubAbi,
  lessThan,
  mintNand,
  openContainer,
  packBits,
  readClockOutput,
  readRiskOutput,
  riskAt,
  riskCircuit,
  riskInput,
  sendMessage,
  tapeout,
  toBits,
  transistorsAbi,
  unpackBits,
  wallStreetClock,
  type RiskPosition,
} from "../src";

/**
 * BE-82, BE-86 and BE-83: the TapeOut path on a fork of X Layer. Our own processor from the factory, an 8-bit `a < b`
 * circuit taped out, evaluated, its container opened and one TapeSend message sent; then the Wall Street Clock and the
 * risk circuit taped out and read onchain against `calendar.ts` and `math.ts`. Start `anvil --fork-url https://rpc.xlayer.tech --chain-id 196 --block-time 1`
 * and run with XLAYER_FORK_RPC_URL.
 */
const forkUrl = process.env.XLAYER_FORK_RPC_URL;
const { tapeoutFactory: FACTORY, tapeoutOpener: OPENER, tapesendHub: HUB, bem: BEM } = xlayerExternal;
/** TapeOut's protocol wallet holds hundreds of BEM; the fork borrows some. */
const BEM_HOLDER: Address = "0x571d447f4f24688eC35Ccf07f1D6993655F6aF15";
const AUTHOR: Address = getAddress("0x00000000000000000000000000000000ce7a0b82");
const WIDTH = 8;
const TIMEOUT_MS = 300_000;

const transport = http(forkUrl ?? "http://127.0.0.1:8545", { timeout: 120_000, retryCount: 2 });
const client = createPublicClient({ chain: xLayer, transport });
const wallet = createWalletClient({ account: AUTHOR, chain: xLayer, transport });
const clients = { client: client as never, wallet: wallet as never };
const rpc = (method: string, params: unknown[]) => client.request({ method: method as never, params: params as never });
const log = (step: string, gas: bigint, fee = 0n) => console.log(`${step}: gas ${gas}, fee ${fee} wei`);

describe.skipIf(!forkUrl)("TapeOut on an X Layer fork (BE-82, BE-86)", () => {
  let cpu: { circuits: Address; transistors: Address };

  beforeAll(async () => {
    await rpc("anvil_impersonateAccount", [AUTHOR]);
    await rpc("anvil_setBalance", [AUTHOR, toHex(10n ** 18n)]);
    await rpc("anvil_impersonateAccount", [BEM_HOLDER]);
    await rpc("anvil_setBalance", [BEM_HOLDER, toHex(10n ** 18n)]);
    expect(await client.readContract({ address: FACTORY, abi: factoryAbi, functionName: "bem" })).toBe(BEM);
    const lend = await wallet.writeContract({ account: BEM_HOLDER, address: BEM, abi: erc20Abi, functionName: "transfer", args: [AUTHOR, 100_000_000n] });
    await client.waitForTransactionReceipt({ hash: lend });
    const created = await createProcessor(clients, FACTORY, { name: "Levra fork test", symbol: "LVRT", story: "BE-82 fork test", supply: 1_000_000n, mintPrice: 0n });
    log("createCPU (fee in BEM units)", created.gasUsed, created.bemFee);
    expect(await client.readContract({ address: FACTORY, abi: factoryAbi, functionName: "isCPU", args: [created.circuits] })).toBe(true);
    cpu = created;
  }, TIMEOUT_MS);

  it(
    "tapes out a < b, evaluates it and sends one TapeSend message",
    async () => {
      const circuit = lessThan(WIDTH);
      const mint = await mintNand(clients, FACTORY, cpu.transistors, BigInt(circuit.gates.length));
      log("mint (fee in BEM units)", mint.gasUsed, mint.bemPaid);
      expect(await client.readContract({ address: cpu.transistors, abi: transistorsAbi, functionName: "balanceOf", args: [AUTHOR, 0n] })).toBe(BigInt(circuit.gates.length));

      const taped = await tapeout(clients, cpu.circuits, circuit);
      log("tapeout", taped.gasUsed, taped.fee);
      expect(taped.gateCount).toBe(circuit.gates.length);
      expect(await client.readContract({ address: cpu.circuits, abi: circuitsAbi, functionName: "ownerOf", args: [taped.id] })).toBe(AUTHOR);
      expect(await client.readContract({ address: cpu.transistors, abi: transistorsAbi, functionName: "balanceOf", args: [AUTHOR, 0n] })).toBe(0n);

      for (const [a, b] of [
        [0n, 0n],
        [3n, 200n],
        [200n, 3n],
        [127n, 128n],
        [255n, 255n],
        [254n, 255n],
      ] as const) {
        const out = await evalCircuit(client, cpu.circuits, taped.id, packBits([...toBits(a, WIDTH), ...toBits(b, WIDTH)]));
        expect(unpackBits(out, 1), `${a} < ${b}`).toEqual([a < b]);
      }

      const opened = await openContainer(clients, OPENER, cpu.circuits, taped.id);
      log("open", opened.gasUsed, opened.fee);

      const to = endpointId(196, opened.container);
      const payload: Hex = stringToHex(JSON.stringify({ v: 1, kind: "levra-spike", circuit: taped.id.toString() }));
      const before = await client.readContract({ address: HUB, abi: hubAbi, functionName: "inboxCount", args: [to] });
      const sent = await sendMessage(clients, HUB, { circuits: cpu.circuits, id: taped.id, to, payload });
      log("send", sent.gasUsed);
      expect(sent.from.toLowerCase()).toBe(opened.container.toLowerCase());
      expect(sent.inboxIndex).toBe(before);
      expect(await client.readContract({ address: HUB, abi: hubAbi, functionName: "inboxCount", args: [to] })).toBe(before + 1n);
    },
    TIMEOUT_MS,
  );

  it(
    "tapes out the Wall Street Clock and reads it onchain like calendar.ts",
    async () => {
      const clock = wallStreetClock(2026, 2030);
      await mintNand(clients, FACTORY, cpu.transistors, BigInt(clock.gates.length));
      const taped = await tapeout(clients, cpu.circuits, clock);
      log(`tapeout clock (${clock.gates.length} NAND)`, taped.gasUsed, taped.fee);
      expect(taped.gateCount).toBe(clock.gates.length);

      const et = (date: string, h: number, m = 0) => etToUnix(date, h * 3600 + m * 60);
      const moments = [et("2026-11-23", 10), et("2026-11-23", 3, 59), et("2026-11-26", 12), et("2026-11-27", 13), et("2026-11-29", 20), et("2027-03-14", 9, 30), et("2025-12-31", 12)];
      for (const unix of moments) {
        const input = clockInput(unix);
        const out = await evalCircuit(client, cpu.circuits, taped.id, input);
        expect(readClockOutput(out), new Date(unix * 1000).toISOString()).toEqual(clockAt(unix, 2026, 2030));
      }
      const data = encodeFunctionData({ abi: circuitsAbi, functionName: "eval", args: [taped.id, clockInput(moments[0]!)] });
      const gas = await client.estimateGas({ to: cpu.circuits, data, account: AUTHOR });
      console.log(`eval clock: gas ${gas}`);
    },
    TIMEOUT_MS,
  );

  it(
    "tapes out the aQQQ risk circuit and reads it onchain like math.ts",
    async () => {
      const pct = (bps: bigint) => (bps * 10n ** 18n) / 10_000n;
      const limits = { lltvWad: pct(7700n), softOpenWad: pct(7300n), softClosedWad: pct(7000n) };
      const risk = riskCircuit(limits);
      await mintNand(clients, FACTORY, cpu.transistors, BigInt(risk.gates.length));
      const taped = await tapeout(clients, cpu.circuits, risk);
      log(`tapeout risk aQQQ (${risk.gates.length} NAND)`, taped.gasUsed, taped.fee);
      expect(taped.gateCount).toBe(risk.gates.length);

      const value = 1_234_567_890_123n;
      const at = (bps: bigint) => (value * pct(bps)) / 10n ** 18n;
      const positions: RiskPosition[] = [
        { debt: 0n, value: 0n, session: "REGULAR", preClose: false },
        { debt: at(7000n), value, session: "REGULAR", preClose: false },
        { debt: at(7150n), value, session: "REGULAR", preClose: false },
        { debt: at(7150n), value, session: "CLOSED", preClose: false },
        { debt: at(7150n), value, session: "REGULAR", preClose: true },
        { debt: at(7700n), value, session: "OVERNIGHT", preClose: false },
        { debt: at(7700n) + 1n, value, session: "UNKNOWN", preClose: false },
        { debt: 5n, value: 0n, session: "PRE_MARKET", preClose: false },
      ];
      for (const p of positions) {
        const out = await evalCircuit(client, cpu.circuits, taped.id, riskInput(p));
        expect(readRiskOutput(out), JSON.stringify(p, (_, v) => (typeof v === "bigint" ? v.toString() : v))).toEqual(riskAt(limits, p));
      }
      const data = encodeFunctionData({ abi: circuitsAbi, functionName: "eval", args: [taped.id, riskInput(positions[2]!)] });
      const gas = await client.estimateGas({ to: cpu.circuits, data, account: AUTHOR });
      console.log(`eval risk aQQQ: gas ${gas}`);
    },
    TIMEOUT_MS,
  );
});
