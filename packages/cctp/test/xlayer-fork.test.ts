import { xlayerExternal } from "@levra/shared/addresses";
import { createPublicClient, createWalletClient, decodeEventLog, erc20Abi, http, parseAbiItem, toHex, type Address } from "viem";
import { xLayer } from "viem/chains";
import { beforeAll, describe, expect, it } from "vitest";
import { TOKEN_MESSENGER_V2, cctpChain, planBurn, type IrisFeeQuote } from "../src";

/**
 * BE-85: the burn the API plans is accepted by Circle's real contracts on an X Layer fork. A withdrawal of 5 USDC to
 * Base: approve, `depositForBurnWithHook`, then the USDC is gone and `DepositForBurn` names Base, the recipient, the
 * max fee, Fast Transfer and the forwarding hook. Start `anvil --fork-url https://rpc.xlayer.tech --chain-id 196` and
 * run with XLAYER_FORK_RPC_URL.
 */
const forkUrl = process.env.XLAYER_FORK_RPC_URL;
/** Morpho on X Layer lends native USDC, so it holds plenty; the fork borrows it as the sender. */
const HOLDER: Address = xlayerExternal.morpho;
const RECIPIENT: Address = "0x00000000000000000000000000000000000B8085";
// Shapes as Iris answered on 24 November 2026 for X Layer to Base (37 to 6).
const fees: IrisFeeQuote[] = [
  { finalityThreshold: 1000, minimumFee: 1.4, forwardFee: { low: 54022, med: 54585, high: 55492 } },
  { finalityThreshold: 2000, minimumFee: 0, forwardFee: { low: 54022, med: 54585, high: 55492 } },
];
const depositForBurn = parseAbiItem(
  "event DepositForBurn(address indexed burnToken, uint256 amount, address indexed depositor, bytes32 mintRecipient, uint32 destinationDomain, bytes32 destinationTokenMessenger, bytes32 destinationCaller, uint256 maxFee, uint32 indexed minFinalityThreshold, bytes hookData)",
);

const transport = http(forkUrl ?? "http://127.0.0.1:8545", { timeout: 60_000 });
const client = createPublicClient({ chain: xLayer, transport });
const wallet = createWalletClient({ account: HOLDER, chain: xLayer, transport });

describe.skipIf(!forkUrl)("CCTP burn on an X Layer fork (BE-85)", () => {
  beforeAll(async () => {
    await client.request({ method: "anvil_impersonateAccount" as never, params: [HOLDER] as never });
    await client.request({ method: "anvil_setBalance" as never, params: [HOLDER, toHex(10n ** 18n)] as never });
  });

  it("burns 5 USDC for Base with the forwarding hook", async () => {
    const xlayer = cctpChain(196)!;
    const plan = planBurn({ from: xlayer, to: cctpChain(8453)!, amount: 5_000_000n, recipient: RECIPIENT, fees });
    const before = await client.readContract({ address: xlayer.usdc, abi: erc20Abi, functionName: "balanceOf", args: [HOLDER] });

    await client.waitForTransactionReceipt({ hash: await wallet.sendTransaction({ to: plan.approve.to, data: plan.approve.data }) });
    const receipt = await client.waitForTransactionReceipt({ hash: await wallet.sendTransaction({ to: plan.burn.to, data: plan.burn.data }) });
    expect(receipt.status).toBe("success");
    console.log(`burn: gas ${receipt.gasUsed}, max fee ${plan.maxFee}`);

    const after = await client.readContract({ address: xlayer.usdc, abi: erc20Abi, functionName: "balanceOf", args: [HOLDER] });
    expect(before - after).toBe(5_000_000n);
    const log = receipt.logs.find((l) => l.address.toLowerCase() === TOKEN_MESSENGER_V2.toLowerCase());
    const event = decodeEventLog({ abi: [depositForBurn], data: log!.data, topics: log!.topics });
    expect(event.args).toMatchObject({ amount: 5_000_000n, destinationDomain: 6, maxFee: plan.maxFee, minFinalityThreshold: 1000 });
    expect(event.args.mintRecipient.toLowerCase()).toBe(`0x${RECIPIENT.slice(2).toLowerCase().padStart(64, "0")}`);
    expect(event.args.hookData).toBe("0x636374702d666f72776172640000000000000000000000000000000000000000");
  }, 120_000);
});
