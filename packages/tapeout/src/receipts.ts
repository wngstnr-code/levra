import { bytesToHex, hexToBytes, type Address, type Hex } from "viem";
import { endpointId } from "./chain";
import { LEVRA_TAPEOUT_XLAYER } from "./levra";
import { encodeContent, open, seal, type Content, type Envelope } from "./tapesend";

/** The envelope of a receipt to `wallet`: from Levra's clock container to the wallet's endpoint on X Layer (BE-84). */
export const receiptEnvelope = (wallet: Address): Envelope => ({
  chainId: LEVRA_TAPEOUT_XLAYER.chainId,
  to: wallet,
  from: LEVRA_TAPEOUT_XLAYER.container,
  hub: LEVRA_TAPEOUT_XLAYER.hub,
});

/** The `to` argument of `send` for a wallet. */
export const receiptEndpoint = (wallet: Address): Hex => endpointId(LEVRA_TAPEOUT_XLAYER.chainId, wallet);

/** Seals a receipt to the wallet's receipt key (32-byte X25519 public key). */
export function sealReceipt(wallet: Address, publicKey: Hex, content: Content): Hex {
  return bytesToHex(seal({ ...receiptEnvelope(wallet), content: encodeContent(content), recipients: [hexToBytes(publicKey)] }));
}

/** Opens a receipt with the wallet's secret receipt key, as the app does. */
export function openReceipt(wallet: Address, secretKey: Uint8Array, payload: Hex) {
  return open({ ...receiptEnvelope(wallet), payload: hexToBytes(payload), secretKey });
}
