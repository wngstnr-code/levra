import { createPublicClient, createWalletClient, erc20Abi, getAddress, http, stringToHex, toHex, type Address, type Hex } from "viem";
import { xLayer } from "viem/chains";
import { describe, expect, it } from "vitest";
import { circuitsAbi, createProcessor, endpointId, evalCircuit, factoryAbi, hubAbi, lessThan, mintNand, openContainer, packBits, sendMessage, tapeout, toBits, transistorsAbi, unpackBits } from "../src";

/**
 * BE-82: the whole TapeOut path on a fork of X Layer: our own processor from the factory, NAND mint, tape out of an
 * 8-bit `a < b` circuit, eval, the circuit's container opened, and one TapeSend message from it. Start
 * `anvil --fork-url https://rpc.xlayer.tech --chain-id 196 --block-time 1` and run with XLAYER_FORK_RPC_URL.
 */
const forkUrl = process.env.XLAYER_FORK_RPC_URL;
// TapeOut on X Layer (05). They move to `xlayerExternal` in packages/shared once Wangsit adds them (PROGRESS blocker).
const FACTORY: Address = "0x1f09DAeFA827f02CBb40967cc91b259763760761";
const OPENER: Address = "0x536add8f30f03b69f6fbf29d425a816a0dc50106";
const HUB: Address = "0xe61A9C7213a6Aa616C246a2B569e555B417b25ee";
const BEM_HOLDER: Address = "0x571d447f4f24688eC35Ccf07f1D6993655F6aF15";
const AUTHOR: Address = getAddress("0x00000000000000000000000000000000ce7a0b82");
const WIDTH = 8;
const TIMEOUT_MS = 300_000;

const transport = http(forkUrl ?? "http://127.0.0.1:8545", { timeout: 120_000, retryCount: 2 });
const client = createPublicClient({ chain: xLayer, transport });
const wallet = createWalletClient({ account: AUTHOR, chain: xLayer, transport });
const clients = { client: client as never, wallet: wallet as never };
const rpc = (method: string, params: unknown[]) => client.request({ method: method as never, params: params as never });

describe.skipIf(!forkUrl)("TapeOut on an X Layer fork (BE-82)", () => {
  it(
    "creates a processor, tapes out a < b, evaluates it and sends one TapeSend message",
    async () => {
      await rpc("anvil_impersonateAccount", [AUTHOR]);
      await rpc("anvil_setBalance", [AUTHOR, toHex(10n ** 18n)]);
      // The processor is paid in BEM: the fork borrows 1 BEM from TapeOut's protocol wallet, which holds hundreds.
      const bem = await client.readContract({ address: FACTORY, abi: factoryAbi, functionName: "bem" });
      await rpc("anvil_impersonateAccount", [BEM_HOLDER]);
      await rpc("anvil_setBalance", [BEM_HOLDER, toHex(10n ** 18n)]);
      const lend = await wallet.writeContract({ account: BEM_HOLDER, address: bem, abi: erc20Abi, functionName: "transfer", args: [AUTHOR, 100_000_000n] });
      await client.waitForTransactionReceipt({ hash: lend });
      const log = (step: string, gas: bigint, fee = 0n) => console.log(`${step}: gas ${gas}, fee ${fee} wei`);

      const cpu = await createProcessor(clients, FACTORY, { name: "Levra fork test", symbol: "LVRT", story: "BE-82 fork test", supply: 1_000_000n, mintPrice: 0n });
      log("createCPU (fee in BEM units)", cpu.gasUsed, cpu.bemFee);
      expect(await client.readContract({ address: FACTORY, abi: factoryAbi, functionName: "isCPU", args: [cpu.circuits] })).toBe(true);

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
});
