import { IrisError, TransferError, cctpChain, cctpChains, planBurn, readTransfer, type BurnPlan, type CctpChain, type IrisMessage, type IrisSource } from "@levra/cctp";
import {
  bridgeDepositRequest,
  bridgeStatusQuery,
  bridgeWithdrawRequest,
  type BridgeChainsResponse,
  type BridgePlan,
  type BridgeStatusResponse,
} from "@levra/shared/api";
import { Hono } from "hono";
import { getAddress } from "viem";
import { createCache } from "../chain/cache";
import { ApiHttpError } from "../errors";
import type { Compliance } from "./compliance";

/** Initial proposals. Circle's fee moves with gas on the destination, so a quote is reused for 30 seconds only. */
const FEES_TTL_MS = 30_000;
/** A status asked again within 5 seconds is answered from memory (Iris blocks callers above 35 requests a second). */
const STATUS_TTL_MS = 5_000;
const STATUS_CACHE_MAX = 5_000;
/** Fast Transfer attests in seconds and the Forwarding Service mints soon after; not measured yet (BE-85). */
const ESTIMATED_SECONDS = 60;

function fromIris(err: unknown): never {
  if (err instanceof IrisError) throw new ApiHttpError(err.code, err.message, undefined, err);
  if (err instanceof TransferError) throw new ApiHttpError("BAD_REQUEST", err.message);
  throw err;
}

const toPlan = (p: BurnPlan): BridgePlan => ({
  fromChainId: p.from.chainId,
  toChainId: p.to.chainId,
  amountRaw: p.amount.toString(),
  maxFeeRaw: p.maxFee.toString(),
  minReceivedRaw: p.minReceived.toString(),
  finality: p.finality,
  estimatedSeconds: ESTIMATED_SECONDS,
  approve: p.approve,
  burn: p.burn,
});

/** Circle's fees for one route, shared by every chain's routes. */
export function irisFees(iris: IrisSource) {
  const cached = createCache();
  return (from: CctpChain, to: CctpChain) => cached(`${from.domain}:${to.domain}`, FEES_TTL_MS, () => iris.fees(from.domain, to.domain).catch(fromIris));
}

const otherChain = (id: number, self: CctpChain, what: string) => {
  const c = cctpChain(id);
  if (!c || c.chainId === self.chainId) throw new ApiHttpError("BAD_REQUEST", `USDC cannot ${what} chain ${id} through CCTP.`);
  return c;
};

/** `/v1/:chainId/bridge/...` (BE-85): CCTP V2 deposits into and withdrawals out of one Levra chain. */
export function bridgeRoutes(chainId: number, fees: ReturnType<typeof irisFees>, compliance?: Compliance) {
  const app = new Hono();
  const self = cctpChain(chainId);
  if (!self) return app;

  app.get("/v1/bridge/chains", (c) =>
    c.json({
      chains: cctpChains.filter((x) => x.chainId !== chainId).map((x) => ({ chainId: x.chainId, name: x.name, domain: x.domain, usdc: x.usdc, fast: x.fastSource })),
    } satisfies BridgeChainsResponse),
  );

  app.post("/v1/bridge/deposit", async (c) => {
    const parsed = bridgeDepositRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new ApiHttpError("BAD_REQUEST", "Invalid deposit request.", parsed.error.issues);
    const req = parsed.data;
    const recipient = getAddress(req.recipient);
    if (compliance) await compliance.require(c, recipient, chainId);
    const from = otherChain(req.fromChainId, self, "come from");
    const quoted = await fees(from, self);
    try {
      return c.json(toPlan(planBurn({ from, to: self, amount: BigInt(req.amountRaw), recipient, fees: quoted })) satisfies BridgePlan);
    } catch (err) {
      return fromIris(err);
    }
  });

  app.post("/v1/bridge/withdraw", async (c) => {
    const parsed = bridgeWithdrawRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new ApiHttpError("BAD_REQUEST", "Invalid withdrawal request.", parsed.error.issues);
    const req = parsed.data;
    const to = otherChain(req.toChainId, self, "go to");
    const quoted = await fees(self, to);
    try {
      return c.json(toPlan(planBurn({ from: self, to, amount: BigInt(req.amountRaw), recipient: getAddress(req.recipient), fees: quoted })) satisfies BridgePlan);
    } catch (err) {
      return fromIris(err);
    }
  });

  return app;
}

/** `GET /v1/bridge/status`: where one burn is, from any CCTP chain to any other. */
export function bridgeStatusRoutes(iris: IrisSource, now: () => number = Date.now) {
  const app = new Hono();
  // Keys are any transaction hash a caller sends, so this cache is bounded: expired entries go when it grows.
  const recent = new Map<string, { at: number; messages: Promise<IrisMessage[]> }>();
  const cached = (key: string, load: () => Promise<IrisMessage[]>) => {
    const hit = recent.get(key);
    if (hit && now() - hit.at < STATUS_TTL_MS) return hit.messages;
    if (recent.size >= STATUS_CACHE_MAX) for (const [k, v] of recent) if (now() - v.at >= STATUS_TTL_MS) recent.delete(k);
    const messages = load();
    messages.catch(() => recent.delete(key));
    if (recent.size < STATUS_CACHE_MAX) recent.set(key, { at: now(), messages });
    return messages;
  };
  app.get("/v1/bridge/status", async (c) => {
    const parsed = bridgeStatusQuery.safeParse(c.req.query());
    if (!parsed.success) throw new ApiHttpError("BAD_REQUEST", "Give fromChainId and the burn's txHash.", parsed.error.issues);
    const { fromChainId, txHash } = parsed.data;
    const from = cctpChain(fromChainId);
    if (!from) throw new ApiHttpError("BAD_REQUEST", `Chain ${fromChainId} is not a CCTP chain this API knows.`);
    const hash = txHash.toLowerCase() as `0x${string}`;
    const messages = await cached(`${from.domain}:${hash}`, () => iris.messages(from.domain, hash).catch(fromIris));
    const s = readTransfer(messages);
    const received = s.amount !== null && s.fee !== null && s.state === "COMPLETE" ? s.amount - s.fee : null;
    return c.json({
      state: s.state,
      fromChainId,
      toChainId: s.toChainId,
      txHash: hash,
      amountRaw: s.amount?.toString() ?? null,
      feeRaw: s.fee?.toString() ?? null,
      receivedRaw: received?.toString() ?? null,
      mintTxHash: s.mintTxHash,
      delayReason: s.delayReason,
      manualMint: s.manualMint,
    } satisfies BridgeStatusResponse);
  });
  return app;
}
