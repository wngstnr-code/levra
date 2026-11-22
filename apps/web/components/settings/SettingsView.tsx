"use client";

import { morphoAbi } from "@levra/shared/abis";
import { useAccount, useReadContract } from "wagmi";
import { queryKeys, useMarkets } from "@/lib/api/hooks";
import { useT } from "@/lib/i18n";
import { privyAppId } from "@/lib/privy";
import { formatWadPercent } from "@/lib/units";
import { useProtection } from "@/lib/useProtection";
import { useRouterUpgrade } from "@/lib/useRouterUpgrade";
import { useTxFlow } from "@/lib/useTxFlow";
import { ProtectionToggle } from "../protection/ProtectionToggle";
import { useSignIn } from "../SignIn";
import { TxSheet } from "../tx/TxSheet";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { EmptyState } from "../ui/EmptyState";
import { ThemeSwitch } from "../theme/ThemeSwitch";
import { TokenIcon } from "../ui/TokenIcon";
import { AlertsCard } from "./AlertsCard";
import { WalletCard } from "./WalletCard";
import { stockOn } from "@/lib/chains";
import { useChain } from "@/lib/useChain";

export function SettingsView() {
  const m = useT();
  const { address } = useAccount();
  const signIn = useSignIn();

  return (
    <div className="space-y-4">
      <h1 className="text-display pt-2 pb-4 text-[40px] leading-tight font-semibold">{m.settings.title}</h1>
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{m.settings.appearance}</h2>
        <ThemeSwitch className="w-full sm:w-80" />
      </Card>
      {!address ? (
        <EmptyState glyph="◎" tone="lime" title={m.positions.connectTitle} body={m.settings.connect} action={signIn && <Button onClick={signIn}>{m.wallet.signIn}</Button>} />
      ) : (
        <div className="grid items-stretch gap-4 lg:grid-cols-[1fr_440px]">
          <div className="flex flex-col gap-4">
            <ProtectionCard user={address} />
            <AlertsCard user={address} />
          </div>
          <div className="flex flex-col gap-4 [&>*:last-child]:flex-1">
            <AuthorizationCard user={address} />
            <OldAccessCard user={address} />
            {privyAppId && <WalletCard />}
          </div>
        </div>
      )}
    </div>
  );
}

function ProtectionCard({ user }: { user: `0x${string}` }) {
  const chain = useChain();
  const m = useT();
  const protection = useProtection(user);
  const markets = useMarkets();
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span aria-hidden className="flex size-10 items-center justify-center rounded-full bg-up font-bold text-on-signal">⛨</span>
        <div>
          <h2 className="text-xl font-semibold">{m.protection.title}</h2>
          <p className="text-[13px] text-fg-2">{m.protection.sub}</p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {(
          [
            [m.protection.what, m.protection.whatBody],
            [m.protection.when, m.protection.whenBody],
            [m.protection.cost, m.protection.costBody],
            [m.protection.notGuaranteed, m.protection.notGuaranteedBody],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="squircle rounded-panel bg-surface-2 px-4 py-3.5">
            <p className="label-caps">{k}</p>
            <p className="mt-1 text-[13px] leading-snug">{v}</p>
          </div>
        ))}
      </div>
      {chain.deployment.markets.map((mk) => {
        const stock = stockOn(chain, mk.symbol);
        const api = markets.data?.markets.find((x) => x.marketId === mk.marketId);
        const name = m.protection.market(stock?.tokenSymbol ?? mk.symbol, mk.side === "long" ? m.trade.long : m.trade.short);
        return (
          <div key={mk.marketId} className="squircle flex items-center gap-3.5 rounded-panel bg-surface-2 px-4 py-3.5">
            <TokenIcon symbol={mk.symbol} size={36} />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold">{name}</p>
              {api && <p className="text-[13px] text-fg-2">{api.softLtvOpenWad === api.softLtvClosedWad ? m.protection.softRuleFlat(formatWadPercent(api.softLtvOpenWad)) : m.protection.softRule(formatWadPercent(api.softLtvOpenWad), formatWadPercent(api.softLtvClosedWad))}</p>}
            </div>
            <ProtectionToggle user={user} marketId={mk.marketId} on={protection.isOn(mk.marketId)} name={name} invalidate={[protection.queryKey, queryKeys.account(user)]} showLabel={false} />
          </div>
        );
      })}
    </Card>
  );
}

function AuthorizationCard({ user }: { user: `0x${string}` }) {
  const chain = useChain();
  const m = useT();
  const flow = useTxFlow();
  const auth = useReadContract({ address: chain.morpho, abi: morphoAbi, functionName: "isAuthorized", args: [user, chain.deployment.router], chainId: chain.id });
  const on = auth.data === true;
  const run = () =>
    void flow.runDirect({
      account: user,
      call: { address: chain.morpho, abi: morphoAbi, functionName: "setAuthorization", args: [chain.deployment.router, !on] },
      invalidate: [auth.queryKey, queryKeys.account(user)],
    });
  return (
    <Card tone="butter" className="flex flex-col gap-3">
      <p className="text-xs font-semibold tracking-wide text-ink/60 uppercase">{m.settings.authorization}</p>
      <p className="text-xl font-semibold">{auth.data === undefined ? m.common.loading : on ? m.settings.authorized : m.settings.notAuthorized}</p>
      <p className="text-[13px] leading-relaxed text-ink/75">{m.settings.authorizationBody}</p>
      <button onClick={flow.review} disabled={auth.data === undefined} className="squircle mt-auto h-12 rounded-full bg-ink text-[15px] font-semibold text-butter transition-transform active:scale-[0.97] disabled:opacity-40">
        {on ? m.settings.revoke : m.settings.allow}
      </button>
      <TxSheet
        title={on ? m.settings.revoke : m.settings.allow}
        state={flow.state}
        sentences={[...(on ? m.settings.revokeSentences : m.settings.allowSentences), m.earn.contract("Morpho")]}
        signatures={0}
        approvals={0}
        confirmLabel={on ? m.settings.revoke : m.settings.allow}
        onConfirm={run}
        onClose={flow.reset}
      />
    </Card>
  );
}

function OldAccessCard({ user }: { user: `0x${string}` }) {
  const chain = useChain();
  const m = useT();
  const flow = useTxFlow();
  const { oldAccess, queryKey } = useRouterUpgrade(user);
  const old = oldAccess[0];
  if (!old) return null;
  const run = () =>
    void flow.runDirect({
      account: user,
      call: { address: chain.morpho, abi: morphoAbi, functionName: "setAuthorization", args: [old, false] },
      invalidate: [queryKey, queryKeys.account(user)],
    });
  return (
    <Card className="flex flex-col gap-3">
      <p className="label-caps">{m.upgrade.oldAccess}</p>
      <p className="text-[13px] leading-relaxed text-fg-2">{m.upgrade.oldAccessBody}</p>
      <Button variant="secondary" onClick={flow.review}>{m.upgrade.removeOld}</Button>
      <TxSheet
        title={m.upgrade.removeOld}
        state={flow.state}
        sentences={[...m.upgrade.removeSentences, m.earn.contract("Morpho")]}
        signatures={0}
        approvals={0}
        confirmLabel={m.upgrade.removeOld}
        onConfirm={run}
        onClose={flow.reset}
      />
    </Card>
  );
}
