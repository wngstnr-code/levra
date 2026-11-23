import { z } from "zod";

/** Circle's attestation API (Iris). It blocks a caller for 5 minutes above 35 requests a second, so callers cache. */
export const IRIS_URL = "https://iris-api.circle.com";

export type IrisErrorCode = "BAD_REQUEST" | "RATE_LIMITED" | "UPSTREAM_ERROR";

export class IrisError extends Error {
  constructor(
    readonly code: IrisErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
  }
}

const feeQuote = z.object({
  finalityThreshold: z.number().int(),
  /** Basis points of the amount, may have decimals (1.3). */
  minimumFee: z.number().nonnegative(),
  /** USDC base units the Forwarding Service charges for the mint on the destination. */
  forwardFee: z.object({ low: z.number().int().nonnegative(), med: z.number().int().nonnegative(), high: z.number().int().nonnegative() }).nullish(),
});
export type IrisFeeQuote = z.infer<typeof feeQuote>;

const decodedBody = z
  .object({
    amount: z.string().nullish(),
    mintRecipient: z.string().nullish(),
    maxFee: z.string().nullish(),
    feeExecuted: z.string().nullish(),
  })
  .passthrough();

const message = z
  .object({
    message: z.string(),
    attestation: z.string(),
    status: z.string(),
    delayReason: z.string().nullish(),
    forwardState: z.string().nullish(),
    forwardTxHash: z.string().nullish(),
    decodedMessage: z
      .object({
        sourceDomain: z.string(),
        destinationDomain: z.string(),
        decodedMessageBody: decodedBody.nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();
export type IrisMessage = z.infer<typeof message>;

export type IrisSource = {
  fees(sourceDomain: number, destinationDomain: number): Promise<IrisFeeQuote[]>;
  /** Messages of one burn transaction; empty until Iris has seen it. */
  messages(sourceDomain: number, txHash: string): Promise<IrisMessage[]>;
};

export function createIris({ baseUrl = IRIS_URL, fetchFn = fetch, timeoutMs = 10_000 }: { baseUrl?: string; fetchFn?: typeof fetch; timeoutMs?: number } = {}): IrisSource {
  async function get(path: string): Promise<unknown> {
    let res: Response;
    try {
      res = await fetchFn(`${baseUrl}${path}`, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
    } catch (err) {
      throw new IrisError("UPSTREAM_ERROR", "Circle's attestation service did not answer.", err);
    }
    if (res.status === 404) return null;
    if (res.status === 429) throw new IrisError("RATE_LIMITED", "Circle's attestation service is busy. Try again shortly.");
    if (res.status === 400) throw new IrisError("BAD_REQUEST", `Circle refused the request: ${await res.text().catch(() => "")}`.trim());
    if (!res.ok) throw new IrisError("UPSTREAM_ERROR", `Circle's attestation service answered ${res.status}.`);
    try {
      return await res.json();
    } catch (err) {
      throw new IrisError("UPSTREAM_ERROR", "Circle's attestation service sent an unreadable answer.", err);
    }
  }

  return {
    async fees(sourceDomain, destinationDomain) {
      const body = await get(`/v2/burn/USDC/fees/${sourceDomain}/${destinationDomain}?forward=true`);
      const parsed = z.array(feeQuote).safeParse(body);
      if (!parsed.success) throw new IrisError("UPSTREAM_ERROR", "Circle sent fees in an unknown shape.", parsed.error);
      return parsed.data;
    },
    async messages(sourceDomain, txHash) {
      const body = await get(`/v2/messages/${sourceDomain}?transactionHash=${encodeURIComponent(txHash)}`);
      if (body === null) return [];
      const parsed = z.object({ messages: z.array(message) }).safeParse(body);
      if (!parsed.success) throw new IrisError("UPSTREAM_ERROR", "Circle sent messages in an unknown shape.", parsed.error);
      return parsed.data.messages;
    },
  };
}
