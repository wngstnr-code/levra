import { createPublicClient, createWalletClient, http, parseEventLogs, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { xLayer } from "viem/chains";
import { describe, expect, it } from "vitest";
import { LEVRA_TAPEOUT_XLAYER, decodeContent, deriveReceiptKey, hubAbi, openReceipt, receiptEndpoint, receiptKeyText, sealReceipt } from "../src";

/**
 * A receipt from Levra's clock container to a plain wallet on a fork of X Layer (BE-84): the live hub accepts a wallet
 * endpoint, and the wallet opens the payload from the `Sent` event with the key from its signature.
 * Start `anvil --fork-url https://rpc.xlayer.tech --chain-id 196` and run with XLAYER_FORK_RPC_URL.
 */
const forkUrl = process.env.XLAYER_FORK_RPC_URL;

describe.skipIf(!forkUrl)("a TapeSend receipt to a wallet on a fork of X Layer (BE-84)", () => {
  it("sends from the clock container and the wallet opens it", async () => {
    const transport = http(forkUrl, { timeout: 120_000 });
    const client = createPublicClient({ chain: xLayer, transport });
    const sender = LEVRA_TAPEOUT_XLAYER.sender;
    const wallet = createWalletClient({ account: sender, chain: xLayer, transport });
    await client.request({ method: "anvil_impersonateAccount" as never, params: [sender] as never });
    await client.request({ method: "anvil_setBalance" as never, params: [sender, toHex(10n ** 17n)] as never });

    const user = privateKeyToAccount(generatePrivateKey());
    const input = { wallet: user.address, hub: LEVRA_TAPEOUT_XLAYER.hub, chainId: 196 };
    const key = deriveReceiptKey({ ...input, signature: await user.signMessage({ message: receiptKeyText(input) }) });
    const content = { subject: "NVDA long closed: +20.00%", body: "NVDA long closed on X Layer.", ts: 1_795_604_400_000, levra: { type: "close", pnlBps: 2000 } };
    const payload = sealReceipt(user.address, toHex(key.publicKey), content);

    const to = receiptEndpoint(user.address);
    const before = await client.readContract({ address: LEVRA_TAPEOUT_XLAYER.hub, abi: hubAbi, functionName: "inboxCount", args: [to] });
    const hash = await wallet.writeContract({
      address: LEVRA_TAPEOUT_XLAYER.hub,
      abi: hubAbi,
      functionName: "send",
      args: [LEVRA_TAPEOUT_XLAYER.circuits, LEVRA_TAPEOUT_XLAYER.clockCircuitId, to, `0x${"0".repeat(64)}`, payload],
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe("success");
    console.log(`receipt send: ${receipt.gasUsed} gas, payload ${(payload.length - 2) / 2} bytes`);
    const [sent] = parseEventLogs({ abi: hubAbi, eventName: "Sent", logs: receipt.logs });
    expect(sent!.args.from.toLowerCase()).toBe(LEVRA_TAPEOUT_XLAYER.container.toLowerCase());
    expect(sent!.args.to).toBe(to);
    expect(await client.readContract({ address: LEVRA_TAPEOUT_XLAYER.hub, abi: hubAbi, functionName: "inboxCount", args: [to] })).toBe(before + 1n);

    const opened = openReceipt(user.address, key.secretKey, sent!.args.payload);
    expect(opened.kind).toBe("sealed");
    expect(decodeContent(opened.content)).toEqual(content);
  }, 300_000);
});
