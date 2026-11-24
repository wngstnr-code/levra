import { xlayerExternal } from "@levra/shared/addresses";
import { xlayerDeployment } from "@levra/shared/deployments/xlayer";
import { createPublicClient, createWalletClient, erc20Abi, getAddress, http, toHex, type Address } from "viem";
import { xLayer } from "viem/chains";
import { describe, expect, it } from "vitest";
import { LEVRA_PROCESSOR as PROCESSOR, circuitsAbi, endpointId, hubAbi, planCircuits, quoteRun, runTapeOut, transistorsAbi, type RunState } from "../src";

/**
 * The mainnet run of `scripts/xlayer-run.ts` on a fork of X Layer (BE-82, D-113), from a fresh signer with borrowed BEM.
 * Start `anvil --fork-url https://rpc.xlayer.tech --chain-id 196 --block-time 1` and run with XLAYER_FORK_RPC_URL.
 */
const forkUrl = process.env.XLAYER_FORK_RPC_URL;
const BEM_HOLDER: Address = "0x571d447f4f24688eC35Ccf07f1D6993655F6aF15";
const SIGNER: Address = getAddress("0x00000000000000000000000000000000ce7a0b83");
const TIMEOUT_MS = 900_000;

describe.skipIf(!forkUrl)("the X Layer TapeOut run on a fork (BE-82)", () => {
  it(
    "makes the processor, tapes out and checks every circuit, opens one container, sends one message, and does nothing on a second run",
    async () => {
      const transport = http(forkUrl, { timeout: 300_000, retryCount: 2 });
      const client = createPublicClient({ chain: xLayer, transport });
      const wallet = createWalletClient({ account: SIGNER, chain: xLayer, transport });
      const rpc = (method: string, params: unknown[]) => client.request({ method: method as never, params: params as never });
      for (const a of [SIGNER, BEM_HOLDER]) {
        await rpc("anvil_impersonateAccount", [a]);
        await rpc("anvil_setBalance", [a, toHex(10n ** 18n)]);
      }
      // 0.15 BEM, the amount Wangsit plans for the deployer.
      await client.waitForTransactionReceipt({ hash: await wallet.writeContract({ account: BEM_HOLDER, address: xlayerExternal.bem, abi: erc20Abi, functionName: "transfer", args: [SIGNER, 15_000_000n] }) });

      const contracts = { factory: xlayerExternal.tapeoutFactory, opener: xlayerExternal.tapeoutOpener, hub: xlayerExternal.tapesendHub };
      const clients = { client: client as never, wallet: wallet as never };
      const saved: RunState[] = [];
      const opts = { contracts, deployment: xlayerDeployment, processor: PROCESSOR, save: (s: RunState) => saved.push(structuredClone(s)), log: console.log };
      const plans = await planCircuits(client as never, xlayerDeployment);
      expect(plans.map((p) => p.key)).toEqual(["clock-2026-2030", "risk-7700-7300-7000", "risk-6250-5800-5000"]);

      const fresh: RunState = { chainId: 196, signer: SIGNER, circuits: {} };
      const quote = await quoteRun(client as never, opts, plans, fresh);
      expect(quote.bem.have).toBeGreaterThanOrEqual(quote.bem.need);
      console.log(`quote: ${quote.bem.need} BEM units, ${quote.okb.need} wei OKB`);
      const okbBefore = await client.getBalance({ address: SIGNER });

      const state = await runTapeOut(clients, opts, plans, fresh);
      const { circuits, transistors } = state.processor!;
      expect(state.pending).toBeUndefined();
      expect(state.mint!.amount).toBe(PROCESSOR.supply.toString());
      for (const p of plans) {
        const c = state.circuits[p.key]!;
        expect(c.gateCount).toBe(p.circuit.gates.length);
        expect(c.checked).toBeGreaterThan(0);
        expect(await client.readContract({ address: circuits, abi: circuitsAbi, functionName: "ownerOf", args: [BigInt(c.id)] })).toBe(SIGNER);
      }
      const used = plans.reduce((n, p) => n + BigInt(p.circuit.gates.length), 0n);
      expect(await client.readContract({ address: transistors, abi: transistorsAbi, functionName: "balanceOf", args: [SIGNER, 0n] })).toBe(PROCESSOR.supply - used);
      expect(await client.readContract({ address: transistors, abi: transistorsAbi, functionName: "minted" })).toBe(PROCESSOR.supply);
      expect(await client.readContract({ address: contracts.hub, abi: hubAbi, functionName: "inboxCount", args: [endpointId(196, state.container!.address)] })).toBe(1n);
      const spent = okbBefore - (await client.getBalance({ address: SIGNER }));
      console.log(`spent ${spent} wei OKB; BEM left ${await client.readContract({ address: xlayerExternal.bem, abi: erc20Abi, functionName: "balanceOf", args: [SIGNER] })}`);
      expect(spent).toBeLessThanOrEqual(quote.okb.need);

      const nonce = await client.getTransactionCount({ address: SIGNER });
      await runTapeOut(clients, opts, plans, state);
      expect(await client.getTransactionCount({ address: SIGNER })).toBe(nonce);
    },
    TIMEOUT_MS,
  );
});
