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
