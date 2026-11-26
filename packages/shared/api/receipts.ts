import { z } from "zod";
import { address, bytes32, hex, rawAmount, unixSeconds } from "./primitives";

/**
 * Private trade receipts through TapeSend (BE-84). The app derives the wallet's receipt key from one signature
 * (`receiptKeyText` and `deriveReceiptKey` in `@levra/tapeout`) and sends only the public key.
 */
export const receiptKeyRequest = z.object({
  /** X25519 public key, 32 bytes. */
  publicKey: bytes32,
  keyIndex: z.number().int().min(0).max(65_535),
});
export type ReceiptKeyRequest = z.infer<typeof receiptKeyRequest>;

/** Where receipts come from: the app needs these to open a payload, since the seal binds the hub and both endpoints. */
export const receiptSender = z.object({
  chainId: z.literal(196),
  hub: address,
  /** The container every receipt is sent from. */
  container: address,
});

export const receiptKeyResponse = z.object({
  key: receiptKeyRequest.nullable(),
  sender: receiptSender,
});
export type ReceiptKeyResponse = z.infer<typeof receiptKeyResponse>;

/** One receipt as sent. `payload` is the sealed TAP-10 payload, the same bytes as in the hub's `Sent` event. */
export const receipt = z.object({
  id: z.string(),
  txHash: bytes32,
  inboxIndex: rawAmount,
  payload: hex,
  sentAt: unixSeconds,
});

export const receiptsResponse = z.object({
  sender: receiptSender,
  /** Newest first, at most 50. */
  items: z.array(receipt),
});
export type ReceiptsResponse = z.infer<typeof receiptsResponse>;
