import { createHmac, timingSafeEqual } from "node:crypto";
import { getAddress, isAddress, type Address } from "viem";

/**
 * Session token after a wallet sign-in (BE-33): `<address>.<expiresAt>.<HMAC-SHA256 of both>`, base64url signature.
 * Stateless, so the API can run more than one instance. Changing `AUTH_SECRET` ends every session.
 */
export function signToken(secret: string, address: Address, expiresAt: number): string {
  const body = `${address.toLowerCase()}.${expiresAt}`;
  return `${body}.${mac(secret, body)}`;
}

/** The wallet behind a token, or null when the token is malformed, forged or expired. */
export function verifyToken(secret: string, token: string, now: number): Address | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [address, expires, sig] = parts as [string, string, string];
  if (!isAddress(address, { strict: false }) || !/^\d+$/.test(expires)) return null;
  const expected = Buffer.from(mac(secret, `${address}.${expires}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (Number(expires) <= now) return null;
  return getAddress(address);
}

const mac = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("base64url");
