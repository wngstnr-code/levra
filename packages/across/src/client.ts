import { z } from "zod";

/** Across API (BE-76, D-120). Every call needs the key as a Bearer token (05). */
export const ACROSS_URL = "https://api.across.to";

export type AcrossErrorCode = "BAD_REQUEST" | "RATE_LIMITED" | "UPSTREAM_ERROR";

export class AcrossError extends Error {
  constructor(
    readonly code: AcrossErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
  }
}

const tokenRef = z.object({ chainId: z.number().int(), address: z.string() }).passthrough();
const party = z.object({ address: z.string() }).passthrough();
const amount = z.string().regex(/^[0-9]+$/);

/** An action the wallet runs. Only the two kinds an approval-funded quote returns are read; any other kind fails. */
export const approveAction = z.object({ kind: z.literal("approve_token"), tokenAddress: z.string(), spender: z.string(), amount, chainId: z.number().int().optional() });
export const sendAction = z.object({ kind: z.literal("send_transaction"), id: z.string(), to: z.string(), data: z.string(), value: amount.default("0"), chainId: z.number().int().optional() });
const anyAction = z.object({ kind: z.string() }).passthrough();

export const acrossQuote = z
  .object({
    orderId: z.string(),
    expiresAt: z.string(),
    expectedFillTimeMs: z.number().nonnegative().nullish(),
    origin: z.object({ token: tokenRef, amount, depositor: party }).passthrough(),
    destination: z.object({ token: tokenRef, amount, minAmount: amount, recipient: party }).passthrough(),
    fee: z.object({ totalFee: z.object({ amount }).passthrough() }).passthrough(),
    /** Read one by one in `planDeposit`, where any kind but these two stops the quote. */
    nextActions: z.array(anyAction),
  })
  .passthrough();
export type AcrossQuote = z.infer<typeof acrossQuote>;

const transferTx = z.object({ type: z.string(), transaction: z.object({ txnRef: z.string(), chainId: z.number().int() }).passthrough() }).passthrough();
export const acrossTransfer = z
  .object({
    status: z.object({ state: z.string(), reason: z.string().nullish(), description: z.string().nullish(), isTerminal: z.boolean() }).passthrough(),
    output: z.object({ amount: amount.nullish() }).passthrough().nullish(),
    transactions: z.array(transferTx).nullish(),
  })
  .passthrough();
export type AcrossTransfer = z.infer<typeof acrossTransfer>;

export type AcrossQuoteRequest = {
  originChainId: number;
  inputToken: string;
  amountRaw: bigint;
  depositor: string;
  destinationChainId: number;
  outputToken: string;
  recipient: string;
};

export type AcrossSource = {
  quote(req: AcrossQuoteRequest): Promise<AcrossQuote>;
  /** Null until Across has seen the deposit (`404 not_found.transfer`). */
  transfer(orderId: string): Promise<AcrossTransfer | null>;
};

/** The error code of either envelope Across answers with: `{ error: { code } }` or the flat gateway `{ code }`. */
function errorCode(body: unknown): { code: string; message: string } {
  const b = body as { error?: { code?: unknown; message?: unknown }; code?: unknown; message?: unknown } | null;
  const code = String(b?.error?.code ?? b?.code ?? "");
  const message = String(b?.error?.message ?? b?.message ?? "");
  return { code, message };
}

export function createAcross({ apiKey, baseUrl = ACROSS_URL, fetchFn = fetch, timeoutMs = 15_000 }: { apiKey: string; baseUrl?: string; fetchFn?: typeof fetch; timeoutMs?: number }): AcrossSource {
  async function call(path: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
    let res: Response;
    try {
      res = await fetchFn(`${baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: "application/json", authorization: `Bearer ${apiKey}`, ...(init.body ? { "content-type": "application/json" } : {}) },
      });
    } catch (err) {
      throw new AcrossError("UPSTREAM_ERROR", "Across did not answer.", err);
    }
    const body: unknown = await res.json().catch(() => null);
    return { status: res.status, body };
  }

  function fail(status: number, body: unknown): never {
    const { code, message } = errorCode(body);
    if (status === 429) throw new AcrossError("RATE_LIMITED", "Across is busy. Try again shortly.");
    // A refused amount, token or route is the caller's to fix; a refused key or anything else is ours.
    if (status === 400 && (code.startsWith("policy.") || code.startsWith("request.") || code.startsWith("route."))) {
      throw new AcrossError("BAD_REQUEST", `Across refused the transfer: ${message || code}`);
    }
    throw new AcrossError("UPSTREAM_ERROR", `Across answered ${status}${code ? ` (${code})` : ""}.`);
  }

  return {
    async quote(req) {
      const { status, body } = await call("/v1/quotes", {
        method: "POST",
        body: JSON.stringify({
          origin: { token: { chainId: req.originChainId, address: req.inputToken }, amount: req.amountRaw.toString(), depositor: req.depositor },
          destination: { token: { chainId: req.destinationChainId, address: req.outputToken }, recipient: req.recipient },
          amountType: "exact_input",
          // A wallet that only approves and sends: the quote then ends with the deposit transaction, nothing to sign or POST.
          capabilities: { operations: [{ kind: "approve_token", ecosystem: "evm" }, { kind: "send_transaction", ecosystem: "evm" }] },
          authorizationPolicy: { allowedTypes: ["approval"] },
        }),
      });
      if (status !== 200) fail(status, body);
      const parsed = acrossQuote.safeParse(body);
      if (!parsed.success) throw new AcrossError("UPSTREAM_ERROR", "Across sent a quote this API cannot read.", parsed.error);
      return parsed.data;
    },
    async transfer(orderId) {
      const { status, body } = await call(`/v1/transfers/${encodeURIComponent(orderId)}`);
      if (status === 404 && errorCode(body).code === "not_found.transfer") return null;
      if (status !== 200) fail(status, body);
      const parsed = acrossTransfer.safeParse(body);
      if (!parsed.success) throw new AcrossError("UPSTREAM_ERROR", "Across sent a transfer this API cannot read.", parsed.error);
      return parsed.data;
    },
  };
}
