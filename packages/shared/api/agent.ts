import { z } from "zod";
import { address, unixSeconds } from "./primitives";
import { quoteCloseRequest, quoteCollateralRequest, quoteOpenRequest } from "./quotes";

/**
 * Actions an agent prepares for the user to sign in the app (BE-77, FE-77). The agent never signs: it stores the
 * request it would quote, the app quotes it again when the user opens the link (a quote lives 20 seconds), shows it,
 * and the wallet signs. Permit signatures are collected by the app, so they are not part of a prepared request.
 */
export const preparedAction = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("open"), request: quoteOpenRequest.omit({ signatures: true }) }),
  z.object({ kind: z.literal("close"), request: quoteCloseRequest }),
  z.object({ kind: z.literal("collateral"), request: quoteCollateralRequest.omit({ signatures: true }) }),
]);
export type PreparedAction = z.infer<typeof preparedAction>;
export type PreparedKind = PreparedAction["kind"];

/** `POST /v1/:chainId/agent/prepare`. The request is quoted once first, so a request that cannot be quoted is refused. */
export const prepareRequest = preparedAction;
export type PrepareRequest = z.infer<typeof prepareRequest>;

export const prepareResponse = z.object({
  id: z.string(),
  /** The page in the web app that shows the action and asks the wallet to sign it. */
  url: z.string().url(),
  expiresAt: unixSeconds,
  /** One plain sentence for the chat, from the quote made at preparation time. */
  summary: z.string(),
});
export type PrepareResponse = z.infer<typeof prepareResponse>;

/** `GET /v1/prepared/:id`. 404 `NOT_FOUND` for an unknown id, 409 `QUOTE_EXPIRED` once `expiresAt` has passed. */
export const preparedResponse = z.intersection(
  preparedAction,
  z.object({
    id: z.string(),
    chainId: z.number().int().positive(),
    user: address,
    summary: z.string(),
    createdAt: unixSeconds,
    expiresAt: unixSeconds,
  }),
);
export type PreparedResponse = z.infer<typeof preparedResponse>;
