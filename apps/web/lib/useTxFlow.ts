"use client";

import type { Requirement, SignatureInput, TxRequest } from "@levra/shared/api";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { erc20Abi, type Abi, type Address, type Hex } from "viem";
import { useConfig } from "wagmi";
import { getPublicClient, sendTransaction, signTypedData, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { monad } from "./chain";
import { describeError } from "./contractErrors";
import { useT } from "./i18n";
import { splitRequirements, toSignatureInput, toTypedData } from "./typedData";

export type FlowPhase = "idle" | "review" | "signing" | "approving" | "wallet" | "pending" | "success" | "error";

export type FlowState = {
  phase: FlowPhase;
  /** Index of the signature or approval being asked for, counted from 1. */
  step: number;
  hash?: Hex;
  error?: string;
};

export type DirectCall = { address: Address; abi: Abi; functionName: string; args: readonly unknown[] };

const MAX_UINT = 2n ** 256n - 1n;

/**
 * Runs one action: free signatures first, then any approval transaction, then the action itself.
 * The caller gives `refresh` to get a new quote with the signatures included, and a `guard` that checks the transaction.
 */
export function useTxFlow() {
  const m = useT();
  const config = useConfig();
  const queryClient = useQueryClient();
  const [state, setState] = useState<FlowState>({ phase: "idle", step: 0 });

  const reset = useCallback(() => setState({ phase: "idle", step: 0 }), []);
  const review = useCallback(() => setState({ phase: "review", step: 0 }), []);

  const finish = useCallback(
    async (hash: Hex, invalidate: readonly (readonly unknown[])[]) => {
      setState({ phase: "pending", step: 0, hash });
      const receipt = await waitForTransactionReceipt(config, { hash, chainId: monad.id });
      if (receipt.status !== "success") throw new Error("reverted");
      await Promise.all(invalidate.map((k) => queryClient.invalidateQueries({ queryKey: k })));
      setState({ phase: "success", step: 0, hash });
    },
    [config, queryClient],
  );

  const fail = useCallback((err: unknown, hash?: Hex) => setState({ phase: "error", step: 0, hash, error: err instanceof Error && err.message === "reverted" ? m.errors.generic : describeError(err, m) }), [m]);

  /** For actions the service builds: sign, approve, re-quote, check, simulate, send. */
  const runQuoted = useCallback(
    async (p: {
      account: Address;
      requirements: Requirement[];
      signatures: SignatureInput[];
      refresh: (signatures: SignatureInput[]) => Promise<{ tx: TxRequest; requirements: Requirement[] }>;
      guard: (tx: TxRequest) => void;
      invalidate: readonly (readonly unknown[])[];
    }) => {
      let hash: Hex | undefined;
      try {
        const signatures = [...p.signatures];
        const { toSign, toApprove } = splitRequirements(p.requirements, signatures);
        for (const [i, req] of toSign.entries()) {
          setState({ phase: "signing", step: i + 1 });
          const sig = await signTypedData(config, { account: p.account, ...toTypedData(req.typedData) });
          signatures.push(toSignatureInput(req, sig));
        }
        for (const [i, req] of toApprove.entries()) {
          setState({ phase: "approving", step: i + 1 });
          const approveHash = await writeContract(config, { address: req.token!, abi: erc20Abi, functionName: "approve", args: [req.spender!, BigInt(req.amountRaw ?? MAX_UINT)], chainId: monad.id });
          await waitForTransactionReceipt(config, { hash: approveHash, chainId: monad.id });
        }
        const fresh = toSign.length || toApprove.length ? await p.refresh(signatures) : null;
        const tx = fresh?.tx ?? (await p.refresh(signatures)).tx;
        p.guard(tx);
        const client = getPublicClient(config, { chainId: monad.id })!;
        await client.call({ account: p.account, to: tx.to, data: tx.data, value: BigInt(tx.value) });
        setState({ phase: "wallet", step: 0 });
        const gas = BigInt(tx.gasLimit);
        hash = await sendTransaction(config, { account: p.account, to: tx.to, data: tx.data, value: BigInt(tx.value), ...(gas > 0n ? { gas } : {}), chainId: monad.id });
        await finish(hash, p.invalidate);
      } catch (err) {
        fail(err, hash);
      }
    },
    [config, finish, fail],
  );

  /** For direct contract calls the app builds itself, such as lending or switching protection. */
  const runDirect = useCallback(
    async (p: { account: Address; approve?: { token: Address; spender: Address; amount: bigint; allowance: bigint }; call: DirectCall; invalidate: readonly (readonly unknown[])[] }) => {
      let hash: Hex | undefined;
      try {
        if (p.approve && p.approve.allowance < p.approve.amount) {
          setState({ phase: "approving", step: 1 });
          const approveHash = await writeContract(config, { address: p.approve.token, abi: erc20Abi, functionName: "approve", args: [p.approve.spender, p.approve.amount], chainId: monad.id });
          await waitForTransactionReceipt(config, { hash: approveHash, chainId: monad.id });
        }
        const client = getPublicClient(config, { chainId: monad.id })!;
        await client.simulateContract({ account: p.account, ...p.call } as Parameters<typeof client.simulateContract>[0]);
        setState({ phase: "wallet", step: 0 });
        hash = await writeContract(config, { ...p.call, chainId: monad.id } as Parameters<typeof writeContract>[1]);
        await finish(hash, p.invalidate);
      } catch (err) {
        fail(err, hash);
      }
    },
    [config, finish, fail],
  );

  return { state, reset, review, runQuoted, runDirect };
}
