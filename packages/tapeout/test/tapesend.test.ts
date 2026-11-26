import { readFileSync } from "node:fs";
import { x25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  TapeSendError,
  assertValidPublicKey,
  decodeContent,
  deriveReceiptKey,
  encodeContent,
  encodePublic,
  endpointId,
  messageId,
  normalizedRS,
  open,
  receiptKeyText,
  seal,
} from "../src";

/** TapeKit's TAP-10 vectors (send/module/test/vectors.json, commit 37c617e, MIT). They all use BNB Smart Chain, 56. */
const V = JSON.parse(readFileSync(new URL("./fixtures/tapekit-vectors.json", import.meta.url), "utf8"));
const BSC = 56;

const code = (f: () => unknown) => {
  try {
    f();
    return "ok";
  } catch (e) {
    expect(e).toBeInstanceOf(TapeSendError);
    return (e as TapeSendError).code;
  }
};

describe("TAP-10 payloads match TapeKit byte for byte", () => {
  it("seals the vector payload and each recipient opens it", () => {
    const s = V.sealed;
    const queue = [s.input.ephemeralSecret, s.input.nonce, s.input.contentKey].map((h: Hex) => hexToBytes(h));
    const env = { chainId: BSC, to: s.input.to, from: s.input.from, hub: s.input.hub, ref: s.input.ref };
    const recipients = s.input.recipientSecretKeys.map((k: Hex) => x25519.getPublicKey(hexToBytes(k)));
    const payload = seal({ ...env, content: hexToBytes(s.input.content), recipients, random: () => queue.shift()! });
    expect(bytesToHex(payload)).toBe(s.payload);
    expect(payload.length).toBe(s.payloadLength);
    for (const k of s.input.recipientSecretKeys) {
      expect(bytesToHex(open({ ...env, payload, secretKey: hexToBytes(k) }).content)).toBe(s.input.content);
    }
  });

  it("gives the same status as TapeKit on every opening vector", () => {
    for (const c of V.opening) {
      const got = code(() => open({ chainId: BSC, to: c.to, from: c.from, hub: c.hub, ref: c.ref, payload: hexToBytes(c.payload), secretKey: hexToBytes(c.secretKey) }));
      expect(got, c.name).toBe(c.expect);
    }
  });

  it("encodes the public vector and refuses the bad recipient keys", () => {
    expect(bytesToHex(encodePublic(hexToBytes(V.public.content)))).toBe(V.public.payload);
    for (const k of V.rejectedRecipientKeys) expect(code(() => assertValidPublicKey(hexToBytes(k.key))), k.name).toBe("bad-key");
  });

  it("computes the message ids and the low-s signature", () => {
    for (const m of V.messageIds) expect(messageId(m.chainId, m.hub, m.to, BigInt(m.inboxIndex))).toBe(m.id);
    for (const k of V.keyDerivation) expect(bytesToHex(normalizedRS(k.signature))).toBe(k.normalizedRS);
    expect(endpointId(BSC, "0x1111111111111111111111111111111111111111")).toBe(V.messageIds[0].to);
  });
});

describe("Levra receipt keys", () => {
  const owner = privateKeyToAccount("0x4242424242424242424242424242424242424242424242424242424242424242");
  const other = privateKeyToAccount("0x4343434343434343434343434343434343434343434343434343434343434343");
  const hub: Address = "0xe61A9C7213a6Aa616C246a2B569e555B417b25ee";
  const container: Address = "0xd2738E919bCE30a7EF36b26f51c8297352a41Ed4";
  const input = { wallet: owner.address, hub, chainId: 196 };

  it("derives the same key from every signature of the wallet, and a receipt sealed to it opens only with it", async () => {
    const text = receiptKeyText(input);
    expect(text.startsWith("app.levra.finance wants you to sign in with your Ethereum account:\n")).toBe(true);
    const signature = await owner.signMessage({ message: text });
    const key = deriveReceiptKey({ ...input, signature });
    expect(bytesToHex(deriveReceiptKey({ ...input, signature: await owner.signMessage({ message: text }) }).publicKey)).toBe(bytesToHex(key.publicKey));
    // The high-s twin of the same signature is the same key.
    const sig = hexToBytes(signature);
    const n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
    const highS = n - BigInt(bytesToHex(sig.slice(32, 64)));
    const twin = bytesToHex(new Uint8Array([...sig.slice(0, 32), ...hexToBytes(`0x${highS.toString(16).padStart(64, "0")}`), sig[64] === 27 ? 28 : 27]));
    expect(bytesToHex(deriveReceiptKey({ ...input, signature: twin }).publicKey)).toBe(bytesToHex(key.publicKey));

    const env = { chainId: 196, to: owner.address, from: container, hub };
    const content = encodeContent({ subject: "Position closed", body: "NVDA long closed", ts: 1_795_000_000_000, levra: { pnlBps: 1234 } });
    const payload = seal({ ...env, content, recipients: [key.publicKey] });
    expect(decodeContent(open({ ...env, payload, secretKey: key.secretKey }).content)).toEqual({ subject: "Position closed", body: "NVDA long closed", ts: 1_795_000_000_000, levra: { pnlBps: 1234 } });

    const stranger = deriveReceiptKey({ wallet: other.address, hub, chainId: 196, signature: await other.signMessage({ message: receiptKeyText({ wallet: other.address, hub, chainId: 196 }) }) });
    expect(code(() => open({ ...env, payload, secretKey: stranger.secretKey }))).toBe("not-for-key");
    // Bound to the recipient endpoint: the same payload read as sent to another wallet does not open.
    expect(code(() => open({ ...env, to: other.address, payload, secretKey: key.secretKey }))).toBe("damaged");
  });

  it("refuses a signature by another wallet, over other text or of the wrong length", async () => {
    expect(code(() => deriveReceiptKey({ ...input, signature: "0x1234" }))).toBe("bad-signature");
    const byOther = await other.signMessage({ message: receiptKeyText(input) });
    expect(code(() => deriveReceiptKey({ ...input, signature: byOther }))).toBe("signer-mismatch");
    const otherText = await owner.signMessage({ message: receiptKeyText({ ...input, keyIndex: 1 }) });
    expect(code(() => deriveReceiptKey({ ...input, signature: otherText }))).toBe("signer-mismatch");
    expect(code(() => receiptKeyText({ ...input, keyIndex: 65_536 }))).toBe("bad-input");
  });

  it("keeps a receipt under the payload limit and refuses an oversized one", () => {
    const key = x25519.getPublicKey(hexToBytes(`0x${"11".repeat(32)}`));
    const env = { chainId: 196, to: owner.address, from: container, hub };
    expect(code(() => seal({ ...env, content: new Uint8Array(16_000), recipients: [key] }))).toBe("too-large");
    expect(code(() => seal({ ...env, content: new Uint8Array(1), recipients: [] }))).toBe("bad-input");
    expect(code(() => seal({ ...env, content: new Uint8Array(1), recipients: [key, key] }))).toBe("bad-input");
  });
});
