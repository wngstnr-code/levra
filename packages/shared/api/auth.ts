import { z } from "zod";
import { hex, unixSeconds } from "./primitives";

export const authNonceResponse = z.object({
  nonce: z.string(),
});
export type AuthNonceResponse = z.infer<typeof authNonceResponse>;

export const siweRequest = z.object({
  message: z.string(),
  signature: hex,
});
export type SiweRequest = z.infer<typeof siweRequest>;

export const siweResponse = z.object({
  token: z.string(),
  expiresAt: unixSeconds,
});
export type SiweResponse = z.infer<typeof siweResponse>;
