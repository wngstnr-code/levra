"use client";

import { marginRouterAbi } from "@levra/shared/abis";
import type { Address, Hex } from "viem";
import { deployment } from "@/lib/deployment";
import { useT } from "@/lib/i18n";
import { useTxFlow } from "@/lib/useTxFlow";
import { TxSheet } from "../tx/TxSheet";
import { Switch } from "../ui/Switch";

/** Turns protection on or off for one market with a direct router call. The sheet says what it means before the wallet opens. */
export function ProtectionToggle({ user, marketId, on, name, invalidate, showLabel = true }: { user: Address; marketId: Hex; on: boolean | undefined; name: string; invalidate: readonly (readonly unknown[])[]; showLabel?: boolean }) {
  const m = useT();
  const flow = useTxFlow();
  const next = !on;
  const run = () =>
    void flow.runDirect({
      account: user,
      call: { address: deployment.router, abi: marginRouterAbi, functionName: "setProtection", args: [marketId, next] },
      invalidate,
    });
  return (
    <span className="flex items-center gap-2.5">
      {showLabel && <span className="text-sm text-fg-2">{m.positions.protection}</span>}
      <Switch on={!!on} disabled={on === undefined} onClick={flow.review} label={next ? m.protection.turnOn(name) : m.protection.turnOff(name)} />
      {showLabel && <span className="w-8 text-sm font-medium">{on ? m.protection.on : m.protection.off}</span>}
      <TxSheet
        title={next ? m.protection.turnOn(name) : m.protection.turnOff(name)}
        state={flow.state}
        sentences={[...(next ? m.protection.sentencesOn(name) : m.protection.sentencesOff(name)), m.trade.contractChecked]}
        signatures={0}
        approvals={0}
        confirmLabel={next ? m.protection.turnOn(name) : m.protection.turnOff(name)}
        onConfirm={run}
        onClose={flow.reset}
      />
    </span>
  );
}
