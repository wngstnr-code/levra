import { AcrossError, planDeposit, type AcrossSource } from "@levra/across";
import { tokensByChain } from "@levra/shared/addresses";
import { acrossDepositRequest, acrossStatusQuery, type AcrossDepositPlan, type AcrossStatusResponse } from "@levra/shared/api";
import { Hono } from "hono";
import { encodeFunctionData, erc20Abi, getAddress, isHex } from "viem";
import { ApiHttpError } from "../errors";
import type { Compliance } from "./compliance";

/** Chains Across delivers USDC to that Levra serves. Across does not list X Layer (05, read on 25 November 2026). */
export const ACROSS_DESTINATIONS = new Set([143, 8453]);

function fromAcross(err: unknown): never {
  if (err instanceof AcrossError) throw new ApiHttpError(err.code, err.message, undefined, err);
  throw err;
}

/**
 * `POST /v1/:chainId/bridge/across/deposit` (BE-76, D-120): a token from another chain into USDC on this one through
 * Across. Only approval-funded quotes: the user's wallet approves and sends the deposit; Across fills on this chain. The
 * API holds no funds and no keys, and checks every quote against the request before the wallet sees it (`planDeposit`).
 */
export function acrossRoutes(chainId: number, across: AcrossSource, compliance?: Compliance, now: () => number = Date.now) {
  const app = new Hono();
  if (!ACROSS_DESTINATIONS.has(chainId)) return app;
  const usdc = tokensByChain[chainId as keyof typeof tokensByChain].USDC.address;

  app.post("/v1/bridge/across/deposit", async (c) => {
    const parsed = acrossDepositRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new ApiHttpError("BAD_REQUEST", "Invalid Across deposit request.", parsed.error.issues);
    const body = parsed.data;
    const recipient = getAddress(body.recipient);
    if (compliance) await compliance.require(c, recipient, chainId);
    if (body.fromChainId === chainId) throw new ApiHttpError("BAD_REQUEST", "The token is already on this chain: swap it here instead.");

    const req = {
      originChainId: body.fromChainId,
      inputToken: getAddress(body.inputToken),
      amountRaw: BigInt(body.amountRaw),
      depositor: getAddress(body.depositor),
      destinationChainId: chainId,
      outputToken: usdc,
      recipient,
    };
    try {
      const plan = planDeposit(req, await across.quote(req), now());
      return c.json({
        orderId: plan.orderId,
        fromChainId: req.originChainId,
        toChainId: chainId,
        inputToken: req.inputToken,
        amountRaw: plan.amountRaw.toString(),
        expectedReceivedRaw: plan.expectedReceivedRaw.toString(),
        minReceivedRaw: plan.minReceivedRaw.toString(),
        feeRaw: plan.feeRaw.toString(),
        expiresAt: plan.expiresAtMs,
        estimatedSeconds: plan.estimatedSeconds,
        approve: plan.approve && {
          to: plan.approve.token,
          data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [plan.approve.spender, plan.approve.amountRaw] }),
          token: plan.approve.token,
          spender: plan.approve.spender,
        },
        deposit: { to: plan.deposit.to, data: plan.deposit.data, valueRaw: plan.deposit.valueRaw.toString() },
      } satisfies AcrossDepositPlan);
    } catch (err) {
      return fromAcross(err);
    }
  });

  return app;
}

const txHash = (ref: string | undefined) => (ref && isHex(ref) && ref.length === 66 ? (ref.toLowerCase() as `0x${string}`) : null);

/** `GET /v1/bridge/across/status`: where one Across order is, whatever its chains. */
export function acrossStatusRoutes(across: AcrossSource) {
  const app = new Hono();
  app.get("/v1/bridge/across/status", async (c) => {
    const parsed = acrossStatusQuery.safeParse(c.req.query());
    if (!parsed.success) throw new ApiHttpError("BAD_REQUEST", "Give the orderId of the Across deposit.", parsed.error.issues);
    const { orderId } = parsed.data;
    const t = await across.transfer(orderId).catch(fromAcross);
    if (!t) {
      return c.json({ orderId, state: "not_found", terminal: false, description: null, depositTxHash: null, fillTxHash: null, receivedRaw: null } satisfies AcrossStatusResponse);
    }
    const tx = (type: string) => txHash(t.transactions?.find((x) => x.type === type)?.transaction.txnRef);
    return c.json({
      orderId,
      state: t.status.state,
      terminal: t.status.isTerminal,
      description: t.status.description ?? null,
      depositTxHash: tx("deposit"),
      fillTxHash: tx("fill"),
      receivedRaw: t.output?.amount ?? null,
    } satisfies AcrossStatusResponse);
  });
  return app;
}
