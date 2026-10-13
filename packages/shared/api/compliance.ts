import { z } from "zod";
import { address, hex, unixSeconds } from "./primitives";

export const eligibilityQuery = z.object({
  address: address.optional(),
});
export type EligibilityQuery = z.infer<typeof eligibilityQuery>;

export const eligibilityResponse = z.object({
  eligible: z.boolean(),
  reason: z.enum(["REGION_BLOCKED"]).nullable(),
  termsVersion: z.string(),
  termsAccepted: z.boolean().nullable(),
});
export type EligibilityResponse = z.infer<typeof eligibilityResponse>;

export const termsAcceptRequest = z.object({
  address,
  termsVersion: z.string(),
  signature: hex,
});
export type TermsAcceptRequest = z.infer<typeof termsAcceptRequest>;

export const termsAcceptResponse = z.object({
  accepted: z.literal(true),
  acceptedAt: unixSeconds,
});
export type TermsAcceptResponse = z.infer<typeof termsAcceptResponse>;

/**
 * The exact text a wallet signs with `personal_sign` to accept the terms (03, "Signed messages"). The API rebuilds it to
 * check the signature, so the web app and the API must build it the same way. `address` is checksummed.
 */
export function termsMessage(termsVersion: string, address: string): string {
  return [
    "Levra terms of use",
    `Version: ${termsVersion}`,
    `Address: ${address}`,
    "I confirm that I am not a resident of, or located in, a restricted region, that I read the risk disclosure, and that I accept the terms of use.",
  ].join("\n");
}
