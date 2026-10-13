"use client";

import { morphoAbi } from "@levra/shared/abis";
import { external } from "@levra/shared/addresses";
import { useAccount, useReadContract } from "wagmi";
import { queryKeys, useMarkets } from "@/lib/api/hooks";
import { monad } from "@/lib/chain";
import { cn } from "@/lib/cn";
import { deployment, stockOf } from "@/lib/deployment";
import { useI18n } from "@/lib/i18n";
import { privyAppId } from "@/lib/privy";
import { formatWadPercent } from "@/lib/units";
import { useProtection } from "@/lib/useProtection";
import { useTxFlow } from "@/lib/useTxFlow";
import { ProtectionToggle } from "../protection/ProtectionToggle";
import { useSignIn } from "../SignIn";
import { TxSheet } from "../tx/TxSheet";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { EmptyState } from "../ui/EmptyState";
import { TokenIcon } from "../ui/TokenIcon";
import { AlertsCard } from "./AlertsCard";
import { WalletCard } from "./WalletCard";

export function SettingsView() {
  const { m, lang, setLang } = useI18n();
  const { address } = useAccount();
  const signIn = useSignIn();

  return (
    <div className="space-y-4">
      <h1 className="text-display pt-2 pb-4 text-[40px] leading-tight font-semibold">{m.settings.title}</h1>
      {!address ? (
        <EmptyState glyph="◎" tone="lime" title={m.positions.connectTitle} body={m.settings.connect} action={signIn && <Button onClick={signIn}>{m.wallet.signIn}</Button>} />
      ) : (
        <div className="grid items-stretch gap-4 lg:grid-cols-[1fr_440px]">
          <div className="flex flex-col gap-4">
            <ProtectionCard user={address} />
            <AlertsCard user={address} />
          </div>
          <div className="flex flex-col gap-4">
            <AuthorizationCard user={address} />
            {privyAppId && <WalletCard />}
            <Card className="flex flex-1 flex-col gap-3">
              <h2 className="text-xl font-semibold">{m.settings.language}</h2>
              <div role="radiogroup" aria-label={m.settings.language} className="flex gap-1 rounded-full bg-surface-2 p-1">
                {(["en", "id"] as const).map((l) => (
                  <button key={l} role="radio" aria-checked={lang === l} onClick={() => setLang(l)} className={cn("flex-1 rounded-full py-2 text-sm font-medium transition-colors", lang === l ? "bg-surface-3 font-semibold" : "text-fg-2")}>
                    {l === "en" ? "English" : "Bahasa Indonesia"}
                  </button>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function ProtectionCard({ user }: { user: `0x${string}` }) {
  const { m } = useI18n();
  const protection = useProtection(user);
  const markets = useMarkets();
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span aria-hidden className="flex size-10 items-center justify-center rounded-full bg-up font-bold text-ink">⛨</span>
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
      {deployment.markets.map((mk) => {
        const stock = stockOf(mk.symbol);
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
  const { m } = useI18n();
  const flow = useTxFlow();
  const auth = useReadContract({ address: external.morpho, abi: morphoAbi, functionName: "isAuthorized", args: [user, deployment.router], chainId: monad.id });
  const on = auth.data === true;
  const run = () =>
    void flow.runDirect({
      account: user,
      call: { address: external.morpho, abi: morphoAbi, functionName: "setAuthorization", args: [deployment.router, !on] },
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
