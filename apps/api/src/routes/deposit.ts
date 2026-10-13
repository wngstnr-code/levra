import { deposits, type Db } from "@levra/db";
import { FINAL_STATUSES, IntentsError, refreshTransfer, type IntentsQuote, type IntentsSource, type IntentsToken, type TransferStatus } from "@levra/intents";
import { tokens as monadTokens } from "@levra/shared/addresses";
import {
  depositQuoteRequest,
  withdrawQuoteRequest,
  type DepositQuoteResponse,
  type DepositStatus,
  type DepositToken,
  type DepositTokensResponse,
  type WithdrawQuoteResponse,
} from "@levra/shared/api";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { getAddress } from "viem";
import { createCache } from "../chain/cache";
import { ApiHttpError } from "../errors";
import type { Compliance } from "./compliance";

/** Initial proposals: 1% slippage, a gas top-up worth about $1, and an hour to send the deposit. */
const SLIPPAGE_BPS = 100;
const GAS_TOPUP_USD_E8 = 100_000_000n;
const QUOTE_DEADLINE_SECONDS = 3_600;
/** A status read from the service is reused for this long. */
const STATUS_FRESH_MS = 10_000;
const TOKENS_TTL_MS = 10 * 60_000;
const MONAD = "monad";

/** Names for the service's chain codes. A code not listed here is shown in capitals. */
const CHAIN_NAMES: Record<string, string> = {
  eth: "Ethereum",
  arb: "Arbitrum",
  base: "Base",
  op: "Optimism",
  pol: "Polygon",
  bsc: "BNB Chain",
  avax: "Avalanche",
  gnosis: "Gnosis",
  bera: "Berachain",
  scroll: "Scroll",
  sol: "Solana",
  btc: "Bitcoin",
  near: "NEAR",
  sui: "Sui",
  ton: "TON",
  tron: "Tron",
  xrp: "XRP Ledger",
  doge: "Dogecoin",
  ltc: "Litecoin",
  zec: "Zcash",
  aptos: "Aptos",
  stellar: "Stellar",
  cardano: "Cardano",
  starknet: "Starknet",
};

const toDepositToken = (t: IntentsToken): DepositToken => ({
  chain: t.blockchain,
  chainName: CHAIN_NAMES[t.blockchain] ?? t.blockchain.toUpperCase(),
  token: t.assetId,
  symbol: t.symbol,
  decimals: t.decimals,
  // The service has no fixed minimum per token; a quote below its limit is refused with the reason.
  minAmountRaw: null,
});

function fromIntentsError(err: unknown): never {
  if (err instanceof IntentsError) throw new ApiHttpError(err.code, err.code === "BAD_REQUEST" ? `The cross-chain service refused: ${err.message}` : err.message, undefined, err);
  throw err;
}

type Row = typeof deposits.$inferSelect;

const toStatus = (r: Row): DepositStatus => ({
  id: r.id,
  status: r.status as TransferStatus,
  originTxHash: r.originTxHash,
  destinationTxHash: r.destinationTxHash,
  amountOutRaw: r.amountOutRaw,
  updatedAt: Math.floor(r.updatedAt.getTime() / 1000),
});

/**
 * Cross-chain deposits and withdrawals through Aurora Intents 1Click (BE-40, BE-41). Every transfer is stored. With
 * `compliance`, a deposit needs an allowed region and accepted terms (BE-52); a withdrawal never does.
 */
export function depositRoutes(db: Db, intents: IntentsSource, compliance?: Compliance) {
  const app = new Hono();
  const cached = createCache();
  const allTokens = () => cached("tokens", TOKENS_TTL_MS, () => intents.tokens().catch(fromIntentsError));
  const monadAsset = async (address: string) => {
    const t = (await allTokens()).find((x) => x.blockchain === MONAD && x.contractAddress?.toLowerCase() === address.toLowerCase());
    if (!t) throw new ApiHttpError("UPSTREAM_ERROR", "The cross-chain service does not list this Monad token right now.");
    return t;
  };
  const otherChainToken = async (chain: string, assetId: string) => {
    const t = (await allTokens()).find((x) => x.assetId === assetId && x.blockchain === chain && x.blockchain !== MONAD);
    if (!t) throw new ApiHttpError("BAD_REQUEST", "This token is not supported on that network.");
    return t;
  };
  const quote = (req: Parameters<IntentsSource["quote"]>[0]) => intents.quote(req).catch(fromIntentsError);

  async function store(kind: "deposit" | "withdraw" | "gas", user: string, q: IntentsQuote, r: { originAsset: string; destinationAsset: string; recipient: string; refundTo: string }) {
    const id = randomUUID();
    const now = new Date();
    await db.insert(deposits).values({
      id,
      kind,
      user: user.toLowerCase(),
      originAsset: r.originAsset,
      destinationAsset: r.destinationAsset,
      amountInRaw: q.amountIn.toString(),
      quotedOutRaw: q.amountOut.toString(),
      depositAddress: q.depositAddress,
      depositMemo: q.depositMemo,
      recipient: r.recipient,
      refundTo: r.refundTo,
      status: "WAITING",
      quote: q.raw as object,
      expiresAt: new Date(q.expiresAt * 1000),
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  app.get("/v1/deposit/tokens", async (c) => {
    const list = (await allTokens()).filter((t) => t.blockchain !== MONAD).map(toDepositToken);
    return c.json({ tokens: list } satisfies DepositTokensResponse);
  });

  app.post("/v1/deposit/quote", async (c) => {
    const parsed = depositQuoteRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new ApiHttpError("BAD_REQUEST", "Invalid deposit request.", parsed.error.issues);
    const req = parsed.data;
    if (compliance) await compliance.require(c, getAddress(req.recipient));
    const amount = BigInt(req.amountRaw);
    if (amount === 0n) throw new ApiHttpError("BAD_REQUEST", "The amount must be above zero.");
    const [origin, usdc] = await Promise.all([otherChainToken(req.originChain, req.originToken), monadAsset(monadTokens.USDC.address)]);
    const deadline = new Date(Date.now() + QUOTE_DEADLINE_SECONDS * 1000);
    const common = { originAsset: origin.assetId, recipient: getAddress(req.recipient), refundTo: req.refundAddress, slippageBps: SLIPPAGE_BPS, deadline };

    const main = await quote({ ...common, destinationAsset: usdc.assetId, amount });
    let gas: { id: string; q: IntentsQuote } | null = null;
    if (req.includeGas) {
      const mon = (await allTokens()).find((t) => t.blockchain === MONAD && t.symbol === "MON");
      if (!mon) throw new ApiHttpError("UPSTREAM_ERROR", "The cross-chain service does not list MON right now.");
      if (!origin.price || origin.price <= 0) throw new ApiHttpError("BAD_REQUEST", "No price for this token, so the gas top-up cannot be sized. Turn it off to continue.");
      const priceE8 = BigInt(Math.round(origin.price * 1e8));
      const gasIn = (GAS_TOPUP_USD_E8 * 10n ** BigInt(origin.decimals) + priceE8 - 1n) / priceE8;
      const q = await quote({ ...common, destinationAsset: mon.assetId, amount: gasIn });
      gas = { id: await store("gas", req.recipient, q, { originAsset: origin.assetId, destinationAsset: mon.assetId, recipient: common.recipient, refundTo: req.refundAddress }), q };
    }
    const id = await store("deposit", req.recipient, main, { originAsset: origin.assetId, destinationAsset: usdc.assetId, recipient: common.recipient, refundTo: req.refundAddress });

    return c.json({
      id,
      depositAddress: main.depositAddress,
      depositMemo: main.depositMemo,
      amountOutRaw: main.amountOut.toString(),
      gasOutRaw: gas ? gas.q.amountOut.toString() : null,
      gasDeposit: gas ? { id: gas.id, depositAddress: gas.q.depositAddress, depositMemo: gas.q.depositMemo, amountInRaw: gas.q.amountIn.toString() } : null,
      estimatedSeconds: main.estimatedSeconds,
      expiresAt: main.expiresAt,
    } satisfies DepositQuoteResponse);
  });

  app.post("/v1/withdraw/quote", async (c) => {
    const parsed = withdrawQuoteRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new ApiHttpError("BAD_REQUEST", "Invalid withdrawal request.", parsed.error.issues);
    const req = parsed.data;
    const amount = BigInt(req.amountRaw);
    if (amount === 0n) throw new ApiHttpError("BAD_REQUEST", "The amount must be above zero.");
    const [destination, usdc] = await Promise.all([otherChainToken(req.destinationChain, req.destinationToken), monadAsset(monadTokens.USDC.address)]);
    const user = getAddress(req.user);
    const q = await quote({
      originAsset: usdc.assetId,
      destinationAsset: destination.assetId,
      amount,
      recipient: req.recipient,
      // A refund goes back to the user's own wallet on Monad.
      refundTo: user,
      slippageBps: SLIPPAGE_BPS,
      deadline: new Date(Date.now() + QUOTE_DEADLINE_SECONDS * 1000),
    });
    if (!/^0x[0-9a-fA-F]{40}$/.test(q.depositAddress)) throw new ApiHttpError("UPSTREAM_ERROR", "The cross-chain service gave a deposit address that is not a Monad address.");
    const id = await store("withdraw", user, q, { originAsset: usdc.assetId, destinationAsset: destination.assetId, recipient: req.recipient, refundTo: user });
    return c.json({ id, depositAddress: getAddress(q.depositAddress), amountOutRaw: q.amountOut.toString(), estimatedSeconds: q.estimatedSeconds, expiresAt: q.expiresAt } satisfies WithdrawQuoteResponse);
  });

  app.get("/v1/deposit/:id", async (c) => {
    const [row] = await db.select().from(deposits).where(eq(deposits.id, c.req.param("id")));
    if (!row) throw new ApiHttpError("NOT_FOUND", "No such transfer.");
    if (FINAL_STATUSES.includes(row.status as TransferStatus) || (row.checkedAt && Date.now() - row.checkedAt.getTime() < STATUS_FRESH_MS)) return c.json(toStatus(row));
    try {
      const [updated] = await db.update(deposits).set(await refreshTransfer(intents, row)).where(eq(deposits.id, row.id)).returning();
      return c.json(toStatus(updated ?? row));
    } catch (err) {
      // The stored status is still true as of its last check; the next poll tries again.
      if (err instanceof IntentsError) return c.json(toStatus(row));
      throw err;
    }
  });

  return app;
}
