import { z } from "zod";

export const apiErrorCode = z.enum([
  "BAD_REQUEST",
  "NOT_FOUND",
  "REGION_BLOCKED",
  "TERMS_NOT_ACCEPTED",
  "UNAUTHORIZED",
  "RATE_LIMITED",
  "NO_ROUTE",
  "INSUFFICIENT_LIQUIDITY",
  "QUOTE_EXPIRED",
  "UPSTREAM_ERROR",
  "INTERNAL",
]);
export type ApiErrorCode = z.infer<typeof apiErrorCode>;

export const apiError = z.object({
  error: z.object({
    code: apiErrorCode,
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiError>;
