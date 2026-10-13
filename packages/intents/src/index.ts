import { z } from "zod";

/**
 * Aurora Intents (NEAR Intents) 1Click API client for cross-chain deposits and withdrawals (BE-40, BE-41), used by the
 * API (quotes, status) and the keeper (watching open transfers). Amounts are base units as decimal strings.
 */

export const ONE_CLICK_URL = "https://1click.chaindefuser.com";

export type IntentsErrorCode = "BAD_REQUEST" | "RATE_LIMITED" | "UPSTREAM_ERROR";

export class IntentsError extends Error {
  constructor(
    readonly code: IntentsErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
  }
}

const token = z.object({
  assetId: z.string(),
  decimals: z.number().int().nonnegative(),
  blockchain: z.string(),
  symbol: z.string(),
  price: z.number().nullish(),
  contractAddress: z.string().nullish(),
});
export type IntentsToken = z.infer<typeof token>;

const quoteResponse = z.object({
  quote: z.object({
    amountIn: z.string(),
    amountOut: z.string(),
    minAmountOut: z.string(),
    timeEstimate: z.number(),
    deadline: z.string().optional(),
    depositAddress: z.string().optional(),
    depositMemo: z.string().nullish(),
  }),
});

export type IntentsQuoteRequest = {
  originAsset: string;
  destinationAsset: string;
  /** Exact amount the user sends, in the origin token's base units. */
  amount: bigint;
  recipient: string;
  refundTo: string;
  slippageBps: number;
  /** Until when the service waits for the deposit. */
  deadline: Date;
};

export type IntentsQuote = {
  depositAddress: string;
  depositMemo: string | null;
  amountIn: bigint;
  amountOut: bigint;
  minAmountOut: bigint;
  estimatedSeconds: number;
  /** When the service stops waiting for the deposit, unix seconds. */
  expiresAt: number;
  /** The whole signed answer, kept for disputes as the service asks. */
  raw: unknown;
};

const statusResponse = z.object({
  status: z.string(),
  updatedAt: z.string(),
  swapDetails: z
    .object({
      amountOut: z.string().nullish(),
      refundedAmount: z.string().nullish(),
      originChainTxHashes: z.array(z.object({ hash: z.string() })).nullish(),
      destinationChainTxHashes: z.array(z.object({ hash: z.string() })).nullish(),
    })
    .nullish(),
});

/** Our status names (03), from the service's. */
export type TransferStatus = "WAITING" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "EXPIRED";
export const FINAL_STATUSES: readonly TransferStatus[] = ["SUCCESS", "REFUNDED", "FAILED", "EXPIRED"];

export type IntentsStatus = {
  status: TransferStatus;
  upstreamStatus: string;
  originTxHash: string | null;
  destinationTxHash: string | null;
  amountOut: bigint | null;
  updatedAt: number;
};

/**
 * PENDING_DEPOSIT and INCOMPLETE_DEPOSIT wait for (more of) the deposit; KNOWN_DEPOSIT_TX and PROCESSING are on the
 * way. The service never says EXPIRED: a quote whose deadline passed with nothing deposited is expired by us.
 */
export function toTransferStatus(upstream: string, expiresAt: number, now: number): TransferStatus {
  switch (upstream) {
    case "SUCCESS":
      return "SUCCESS";
    case "REFUNDED":
      return "REFUNDED";
    case "FAILED":
      return "FAILED";
    case "KNOWN_DEPOSIT_TX":
    case "PROCESSING":
      return "PROCESSING";
    default:
      return now >= expiresAt && upstream === "PENDING_DEPOSIT" ? "EXPIRED" : "WAITING";
  }
}

export type IntentsSource = {
  tokens(): Promise<IntentsToken[]>;
  quote(req: IntentsQuoteRequest): Promise<IntentsQuote>;
  status(depositAddress: string, depositMemo: string | null, expiresAt: number): Promise<IntentsStatus>;
};

/** A stored transfer, as far as a status refresh needs it. */
export type StoredTransfer = {
  depositAddress: string;
  depositMemo: string | null;
  expiresAt: Date;
  status: string;
  upstreamStatus: string | null;
  originTxHash: string | null;
  destinationTxHash: string | null;
  amountOutRaw: string | null;
  updatedAt: Date;
};

/** Values to store after reading the service's status. `updatedAt` moves only when the status changed. */
export async function refreshTransfer(intents: IntentsSource, row: StoredTransfer) {
  const s = await intents.status(row.depositAddress, row.depositMemo, Math.floor(row.expiresAt.getTime() / 1000));
  const now = new Date();
  const changed = s.status !== row.status || s.upstreamStatus !== row.upstreamStatus;
  return {
    status: s.status,
    upstreamStatus: s.upstreamStatus,
    originTxHash: s.originTxHash ?? row.originTxHash,
    destinationTxHash: s.destinationTxHash ?? row.destinationTxHash,
    amountOutRaw: s.amountOut !== null ? s.amountOut.toString() : row.amountOutRaw,
    checkedAt: now,
    updatedAt: changed ? now : row.updatedAt,
  };
}

export type IntentsOptions = {
  baseUrl?: string;
  /** Partner token. Without one the service adds its own 0.2% app fee to every quote (measured 13 October 2026). */
  jwt?: string;
  timeoutMs?: number;
};

export function createIntents({ baseUrl = ONE_CLICK_URL, jwt, timeoutMs = 20_000 }: IntentsOptions = {}): IntentsSource {
  // The service rejects some HTTP clients' default user agent (05).
  const headers: Record<string, string> = { "user-agent": "Mozilla/5.0 (compatible; levra-backend)", "content-type": "application/json" };
  if (jwt) headers.authorization = `Bearer ${jwt}`;

  async function call<T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      throw new IntentsError("UPSTREAM_ERROR", "The cross-chain service did not answer.", err);
    }
    const text = await res.text();
    if (res.status === 429) throw new IntentsError("RATE_LIMITED", "The cross-chain service is busy. Try again shortly.");
    if (res.status >= 400 && res.status < 500) {
      const message = (() => {
        try {
          return String((JSON.parse(text) as { message?: unknown }).message ?? text);
        } catch {
          return text;
        }
      })();
      throw new IntentsError("BAD_REQUEST", message.slice(0, 300) || "The cross-chain service refused the request.");
    }
    if (!res.ok) throw new IntentsError("UPSTREAM_ERROR", `The cross-chain service answered ${res.status}.`);
    const parsed = schema.safeParse(JSON.parse(text));
    if (!parsed.success) throw new IntentsError("UPSTREAM_ERROR", "The cross-chain service answered in an unknown shape.", parsed.error);
    return parsed.data;
  }

  return {
    tokens: () => call("/v0/tokens", z.array(token)),

    async quote(req) {
      const body = {
        dry: false,
        swapType: "EXACT_INPUT",
        slippageTolerance: req.slippageBps,
        originAsset: req.originAsset,
        depositType: "ORIGIN_CHAIN",
        destinationAsset: req.destinationAsset,
        amount: req.amount.toString(),
        refundTo: req.refundTo,
        refundType: "ORIGIN_CHAIN",
        recipient: req.recipient,
        recipientType: "DESTINATION_CHAIN",
        deadline: req.deadline.toISOString(),
      };
      const raw = await call("/v0/quote", z.unknown(), body);
      const r = quoteResponse.safeParse(raw);
      if (!r.success || !r.data.quote.depositAddress) throw new IntentsError("UPSTREAM_ERROR", "The cross-chain service gave no deposit address.", r.success ? undefined : r.error);
      const q = r.data.quote;
      return {
        depositAddress: q.depositAddress!,
        depositMemo: q.depositMemo ?? null,
        amountIn: BigInt(q.amountIn),
        amountOut: BigInt(q.amountOut),
        minAmountOut: BigInt(q.minAmountOut),
        estimatedSeconds: Math.max(0, Math.round(q.timeEstimate)),
        expiresAt: Math.floor(new Date(q.deadline ?? req.deadline).getTime() / 1000),
        raw,
      };
    },

    async status(depositAddress, depositMemo, expiresAt) {
      const query = new URLSearchParams({ depositAddress, ...(depositMemo ? { depositMemo } : {}) });
      const s = await call(`/v0/status?${query}`, statusResponse);
      const details = s.swapDetails;
      const updatedAt = Math.floor(new Date(s.updatedAt).getTime() / 1000);
      return {
        status: toTransferStatus(s.status, expiresAt, Math.floor(Date.now() / 1000)),
        upstreamStatus: s.status,
        originTxHash: details?.originChainTxHashes?.[0]?.hash ?? null,
        destinationTxHash: details?.destinationChainTxHashes?.[0]?.hash ?? null,
        amountOut: details?.amountOut ? BigInt(details.amountOut) : null,
        updatedAt,
      };
    },
  };
}
