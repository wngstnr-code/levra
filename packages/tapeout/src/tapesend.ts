import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { bytesToHex, getAddress, hashMessage, hexToBytes, type Address, type Hex } from "viem";

/**
 * TapeSend payloads in the TAP-10 v2 format of TapeKit (`send/module`, commit 37c617e): X25519 key agreement, one
 * XChaCha20-Poly1305 content key wrapped per recipient, bound to the endpoints, the ref and the hub. The test checks it
 * byte for byte against TapeKit's vectors.
 *
 * The recipient key is Levra's own (BE-84): TapeSend publishes keys only for circuit containers, so a wallet that holds
 * no circuit gets its key from one signature in the Levra app instead. The derivation copies TAP-10 section 4 with
 * Levra's text, domain and labels, and the receipt goes to the wallet's endpoint on X Layer.
 */

export class TapeSendError extends Error {
  constructor(
    readonly code: "bad-input" | "bad-key" | "bad-signature" | "signer-mismatch" | "too-large" | "unsupported" | "damaged" | "not-for-key",
    message: string,
  ) {
    super(message);
  }
}

export const MAX_PAYLOAD = 16_000;
export const MAX_SLOTS = 16;
const MAGIC = [0x54, 0x53];
const FORMAT_VERSION = 0x02;
const KIND_PUBLIC = 0x00;
const KIND_SEALED = 0x01;
const PREAMBLE = 93;
const SLOT = 56;
const TAG = 16;
const P_FIELD = 2n ** 255n - 19n;
const SECP256K1_N = secp256k1.CURVE.n;

const ascii = (s: string) => new TextEncoder().encode(s);
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const uint256 = (v: bigint) => hexToBytes(`0x${v.toString(16).padStart(64, "0")}`);
const bytes32 = (h: Hex, name: string) => {
  const b = hexToBytes(h);
  if (b.length !== 32) throw new TapeSendError("bad-input", `${name} must be 32 bytes`);
  return b;
};

/** A TapeSend endpoint as bytes: uint32(0) ‖ uint64(chainId) ‖ address. */
export function endpointBytes(chainId: number, address: Address): Uint8Array {
  if (!Number.isSafeInteger(chainId) || chainId < 1) throw new TapeSendError("bad-input", "chainId must be a positive integer");
  const a = hexToBytes(getAddress(address));
  if (a.every((x) => x === 0)) throw new TapeSendError("bad-input", "endpoint address must be non-zero");
  return concat(new Uint8Array(4), uint256(BigInt(chainId)).slice(24), a);
}

/** Who a payload is from and to, on which hub. `ref` is the 32-byte ref passed to `send` (zero when none). */
export type Envelope = { chainId: number; to: Address; from: Address; hub: Address; ref?: Hex };

const ZERO_REF = new Uint8Array(32);

function context(e: Envelope): Uint8Array {
  const ref = e.ref === undefined ? ZERO_REF : bytes32(e.ref, "ref");
  return concat(ascii("TAP-10/X/v2"), endpointBytes(e.chainId, e.to), endpointBytes(e.chainId, e.from), ref, hexToBytes(getAddress(e.hub)));
}

/** TAP-10 section 4.4: a canonical X25519 public key that is not a low-order point. */
export function assertValidPublicKey(key: Uint8Array): void {
  if (key.length !== 32) throw new TapeSendError("bad-key", "public key must be 32 bytes");
  if (key[31]! & 0x80) throw new TapeSendError("bad-key", "public key top bit set");
  let u = 0n;
  for (let i = 31; i >= 0; i--) u = (u << 8n) | BigInt(key[i]!);
  if (u >= P_FIELD) throw new TapeSendError("bad-key", "public key not canonical");
  sharedSecret(Uint8Array.of(...new Uint8Array(31).fill(0x11), 0x41), key);
}

function sharedSecret(secretKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  let ss: Uint8Array;
  try {
    ss = x25519.getSharedSecret(secretKey, publicKey);
  } catch {
    throw new TapeSendError("bad-key", "X25519 key agreement failed (invalid or low-order key)");
  }
  if (ss.every((b) => b === 0)) throw new TapeSendError("bad-key", "all-zero X25519 shared secret");
  return ss;
}

const commitment = (k: Uint8Array) => sha256(concat(ascii("TAP-10/commit/v2"), k));
const kek = (ss: Uint8Array, e: Uint8Array, r: Uint8Array, t: Uint8Array) => hkdf(sha256, ss, ascii("TAP-10/wrap/v2"), concat(e, r, t), 32);
const fingerprint = (publicKey: Uint8Array) => sha256(publicKey).slice(0, 8);

/** A public (not encrypted) payload. Anyone can read it onchain. */
export function encodePublic(content: Uint8Array): Uint8Array {
  const payload = concat(Uint8Array.of(...MAGIC, FORMAT_VERSION, KIND_PUBLIC), content);
  if (payload.length > MAX_PAYLOAD) throw new TapeSendError("too-large", `payload ${payload.length} > ${MAX_PAYLOAD}`);
  return payload;
}

/** Seals `content` to 1 to 16 recipient keys. `random` exists only for the test vectors; production uses the default. */
export function seal(p: Envelope & { content: Uint8Array; recipients: Uint8Array[]; random?: (n: number) => Uint8Array }): Uint8Array {
  const rand = p.random ?? randomBytes;
  const keys = p.recipients;
  if (keys.length < 1 || keys.length > MAX_SLOTS) throw new TapeSendError("bad-input", `1..${MAX_SLOTS} recipient keys required`);
  keys.forEach((k, i) => {
    assertValidPublicKey(k);
    if (keys.slice(0, i).some((o) => equal(o, k))) throw new TapeSendError("bad-input", "duplicate recipient key");
  });
  const t = context(p);
  const eph = rand(32);
  const e = x25519.getPublicKey(eph);
  const nonce = rand(24);
  const k = rand(32);
  const pre = concat(Uint8Array.of(...MAGIC, FORMAT_VERSION, KIND_SEALED), e, nonce, commitment(k), Uint8Array.of(keys.length));
  const slots = keys.map((r) => {
    const wrapKey = kek(sharedSecret(eph, r), e, r, t);
    if (equal(wrapKey, k)) throw new TapeSendError("bad-input", "content key collides with a key-encryption key");
    return concat(fingerprint(r), xchacha20poly1305(wrapKey, nonce, concat(pre, t)).encrypt(k));
  });
  const s = concat(...slots);
  const payload = concat(pre, s, xchacha20poly1305(k, nonce, concat(pre, s, t)).encrypt(p.content));
  if (payload.length > MAX_PAYLOAD) throw new TapeSendError("too-large", `payload ${payload.length} > ${MAX_PAYLOAD}`);
  return payload;
}

/** Opens a public or sealed payload. Errors carry the TAP-10 status code (`not-for-key`, `damaged`, `unsupported`). */
export function open(p: Envelope & { payload: Uint8Array; secretKey?: Uint8Array }): { kind: "public" | "sealed"; content: Uint8Array } {
  const b = p.payload;
  if (b.length < 4 || b.length > MAX_PAYLOAD) throw new TapeSendError("unsupported", "payload too short or too large");
  if (b[0] !== MAGIC[0] || b[1] !== MAGIC[1] || b[2] !== FORMAT_VERSION) throw new TapeSendError("unsupported", "unknown magic or version");
  if (b[3] === KIND_PUBLIC) return { kind: "public", content: b.slice(4) };
  if (b[3] !== KIND_SEALED) throw new TapeSendError("unsupported", "unknown kind");
  if (b.length < PREAMBLE) throw new TapeSendError("damaged", "sealed payload too short");
  const n = b[92]!;
  if (n < 1 || n > MAX_SLOTS || b.length < PREAMBLE + SLOT * n + TAG) throw new TapeSendError("damaged", "bad slot count or length");
  const e = b.slice(4, 36);
  const nonce = b.slice(36, 60);
  const commit = b.slice(60, 92);
  const pre = b.slice(0, PREAMBLE);
  const s = b.slice(PREAMBLE, PREAMBLE + SLOT * n);
  try {
    assertValidPublicKey(e);
  } catch {
    throw new TapeSendError("damaged", "ephemeral key is invalid");
  }
  if (!p.secretKey) throw new TapeSendError("not-for-key", "a secret key is required to open a sealed message");
  const t = context(p);
  const r = x25519.getPublicKey(p.secretKey);
  const fp = fingerprint(r);
  let k: Uint8Array | null = null;
  let matched = false;
  for (let i = 0; i < n && !k; i++) {
    const slot = s.slice(SLOT * i, SLOT * (i + 1));
    if (!equal(slot.slice(0, 8), fp)) continue;
    matched = true;
    let candidate: Uint8Array;
    try {
      candidate = xchacha20poly1305(kek(sharedSecret(p.secretKey, e), e, r, t), nonce, concat(pre, t)).decrypt(slot.slice(8));
    } catch {
      continue;
    }
    if (equal(commitment(candidate), commit)) k = candidate;
  }
  if (!k) {
    if (matched) throw new TapeSendError("damaged", "a key slot for this key did not open");
    throw new TapeSendError("not-for-key", "no key slot opens with this key");
  }
  try {
    return { kind: "sealed", content: xchacha20poly1305(k, nonce, concat(pre, s, t)).decrypt(b.slice(PREAMBLE + SLOT * n)) };
  } catch {
    throw new TapeSendError("damaged", "content failed authentication");
  }
}

/** TAP-10 section 7: a message id from the sending chain, the hub, the recipient endpoint (`endpointId`) and its inbox index. */
export function messageId(chainId: number, hub: Address, to: Hex, inboxIndex: bigint): Hex {
  return bytesToHex(keccak_256(concat(ascii("TAP-10/msg/v2"), uint256(BigInt(chainId)), hexToBytes(getAddress(hub)), bytes32(to, "to"), uint256(inboxIndex))));
}

/** The low-s r ‖ s of a 65-byte signature: the key material, the same for every encoding of one signature. */
export function normalizedRS(signature: Hex): Uint8Array {
  const sig = hexToBytes(signature);
  if (sig.length !== 65) throw new TapeSendError("bad-signature", "signature must be 65 bytes");
  const r = BigInt(bytesToHex(sig.slice(0, 32)));
  let s = BigInt(bytesToHex(sig.slice(32, 64)));
  if (r === 0n || r >= SECP256K1_N || s === 0n || s >= SECP256K1_N) throw new TapeSendError("bad-signature", "r or s out of range");
  if (s > SECP256K1_N >> 1n) s = SECP256K1_N - s;
  return concat(sig.slice(0, 32), uint256(s));
}

function recoverSigner(text: string, signature: Hex): Address {
  const sig = hexToBytes(signature);
  if (sig.length !== 65) throw new TapeSendError("bad-signature", "signature must be 65 bytes");
  let v = sig[64]!;
  if (v >= 27) v -= 27;
  if (v !== 0 && v !== 1) throw new TapeSendError("bad-signature", "invalid recovery id");
  try {
    const point = secp256k1.Signature.fromCompact(sig.slice(0, 64)).addRecoveryBit(v).recoverPublicKey(hexToBytes(hashMessage(text)));
    return getAddress(bytesToHex(keccak_256(point.toRawBytes(false).slice(1)).slice(12)));
  } catch {
    throw new TapeSendError("bad-signature", "signature does not recover");
  }
}

/** The domain in the key text. Wallets compare it with the site that asks for the signature (EIP-4361). */
export const RECEIPT_KEY_DOMAIN = "app.levra.finance";
const RECEIPT_KEY_ISSUED_AT = "2026-11-25T00:00:00Z";

export type ReceiptKeyInput = { wallet: Address; hub: Address; chainId: number; keyIndex?: number };

/**
 * The fixed text the wallet signs once (EIP-4361 form). Every field is fixed, so a wallet with deterministic signatures
 * (every EOA, RFC 6979) signs the same bytes each time and gets the same key back on any device.
 */
export function receiptKeyText({ wallet, hub, chainId, keyIndex = 0 }: ReceiptKeyInput): string {
  if (!Number.isInteger(keyIndex) || keyIndex < 0 || keyIndex > 65_535) throw new TapeSendError("bad-input", "keyIndex must be 0 to 65535");
  return [
    `${RECEIPT_KEY_DOMAIN} wants you to sign in with your Ethereum account:`,
    getAddress(wallet),
    "",
    `Create the Levra key that opens your private trade receipts on X Layer. Anyone who obtains this signature can read your receipts. Only sign this on ${RECEIPT_KEY_DOMAIN}.`,
    "",
    `URI: https://${RECEIPT_KEY_DOMAIN}`,
    "Version: 1",
    `Chain ID: ${chainId}`,
    `Nonce: levrareceiptkey${keyIndex}`,
    `Issued At: ${RECEIPT_KEY_ISSUED_AT}`,
    "Resources:",
    `- levra:receipts:${getAddress(wallet)}`,
    `- tapesend:hub:${getAddress(hub)}`,
    `- levra:key-index:${keyIndex}`,
  ].join("\n");
}

/**
 * The wallet's receipt key pair from its signature over `receiptKeyText`. Runs in the app; only the public key leaves
 * the device. Refuses a signature that is not the wallet's.
 */
export function deriveReceiptKey(p: ReceiptKeyInput & { signature: Hex }): { secretKey: Uint8Array; publicKey: Uint8Array } {
  const keyIndex = p.keyIndex ?? 0;
  const text = receiptKeyText({ ...p, keyIndex });
  if (recoverSigner(text, p.signature) !== getAddress(p.wallet)) throw new TapeSendError("signer-mismatch", "the signature is not the wallet's over the key text");
  const info = concat(endpointBytes(p.chainId, p.wallet), uint256(BigInt(keyIndex)), hexToBytes(getAddress(p.hub)));
  const secretKey = hkdf(sha256, normalizedRS(p.signature), ascii("Levra/receipt-key/v1"), info, 32);
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}

/**
 * Message content in the TAP-10 v1 content format (`{v, kind: "message", subject, body, ts}`), which the TapeSend
 * client shows as text. `levra` carries the same facts in a form the Levra app reads; other clients ignore it.
 */
export type Content = { subject: string; body: string; ts: number; levra?: Record<string, string | number | boolean | null> };

export function encodeContent(c: Content): Uint8Array {
  if ([...c.subject].length > 200) throw new TapeSendError("bad-input", "subject longer than 200 characters");
  if (!Number.isSafeInteger(c.ts) || c.ts < 0) throw new TapeSendError("bad-input", "ts must be a non-negative integer");
  return ascii(JSON.stringify({ v: 1, kind: "message", subject: c.subject, body: c.body, ts: c.ts, ...(c.levra ? { levra: c.levra } : {}) }));
}

export function decodeContent(bytes: Uint8Array): Content {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new TapeSendError("damaged", "content is not UTF-8 JSON");
  }
  const v = value as Partial<Content> & { v?: unknown; kind?: unknown };
  if (v === null || typeof v !== "object" || v.v !== 1 || v.kind !== "message" || typeof v.body !== "string") throw new TapeSendError("unsupported", "not a TAP-10 v1 message");
  return { subject: typeof v.subject === "string" ? v.subject : "", body: v.body, ts: typeof v.ts === "number" ? v.ts : 0, ...(v.levra && typeof v.levra === "object" ? { levra: v.levra } : {}) };
}
