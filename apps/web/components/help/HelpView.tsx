"use client";

import { external, tokens } from "@levra/shared/addresses";
import { monad } from "@/lib/chain";
import { deployment, stockOf } from "@/lib/deployment";
import { useT } from "@/lib/i18n";
import { Card } from "../ui/Card";

const tones = ["lime", "peri", "butter"] as const;

export function HelpView() {
  const m = useT();
  const h = m.help;
  const explorer = monad.blockExplorers.default.url;
  const contracts: [string, string][] = [
    [h.names.router, deployment.router],
    [h.names.riskManager, deployment.riskManager],
    [h.names.lens, deployment.lens],
    ...(deployment.liquidator ? ([[h.names.liquidator, deployment.liquidator]] as [string, string][]) : []),
    ...(deployment.usdcVault ? ([[h.names.vault, deployment.usdcVault]] as [string, string][]) : []),
    ...deployment.markets.map((mk) => [h.sessionOracle(stockOf(mk.symbol)?.tokenSymbol ?? mk.symbol, mk.side === "long" ? m.trade.long : m.trade.short), mk.oracle] as [string, string]),
    [h.names.morpho, external.morpho],
    [h.names.oracle, external.anchoredStockOracle],
    [h.names.usdc, tokens.USDC.address],
    ["aQQQ", tokens.aQQQ.address],
    ["aHOOD", tokens.aHOOD.address],
    ["aBIL", tokens.aBIL.address],
  ];
  const sections = Object.entries(h.nav) as [keyof typeof h.nav, string][];
  const anchor: Record<keyof typeof h.nav, string> = { how: "how", risks: "risks", glossary: "glossary", faq: "faq", revoke: "revoke", contracts: "contracts" };

  return (
    <div className="space-y-4">
      <div className="pt-2 pb-4">
        <h1 className="text-display text-[40px] leading-tight font-semibold">{h.title}</h1>
        <p className="mt-2 text-[15px] text-fg-2">{h.subtitle}</p>
      </div>
      <div className="grid items-start gap-8 lg:grid-cols-[220px_1fr]">
        <nav aria-label={h.title} className="flex flex-wrap gap-2 lg:sticky lg:top-28 lg:flex-col lg:gap-3">
          {sections.map(([k, label]) => (
            <a key={k} href={`#${anchor[k]}`} className="rounded-full bg-surface-1 px-3.5 py-1.5 text-sm text-fg-2 hover:text-fg lg:bg-transparent lg:p-0">
              {label}
            </a>
          ))}
        </nav>
        <div className="min-w-0 space-y-4">
          <section id="how" className="scroll-mt-28 space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              {h.pillars.map((p, i) => (
                <Card key={p.k} tone={tones[i]} className="flex flex-col gap-1.5 p-6">
                  <p className="text-xs font-semibold tracking-wide text-ink/60 uppercase">{p.k}</p>
                  <p className="text-display text-[22px] font-semibold">{p.t}</p>
                  <p className="text-[13px] text-ink/75">{p.b}</p>
                </Card>
              ))}
            </div>
            <Card>
              <h2 className="text-xl font-semibold">{h.how}</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-fg-2">{h.howBody}</p>
            </Card>
          </section>
          <Card id="risks" className="scroll-mt-28 space-y-3">
            <h2 className="text-xl font-semibold">{h.risks}</h2>
            <p className="text-[13px] text-caution">{h.draft}</p>
            <ul className="space-y-2.5">
              {h.riskList.map((r) => (
                <li key={r} className="flex gap-3 text-[15px]">
                  <span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-caution" />
                  {r}
                </li>
              ))}
            </ul>
          </Card>
          <Card id="glossary" className="scroll-mt-28 space-y-3">
            <h2 className="text-xl font-semibold">{h.glossary}</h2>
            <dl className="grid gap-3 md:grid-cols-2">
              {h.terms.map((t) => (
                <div key={t.id} id={t.id} className="squircle scroll-mt-28 rounded-panel bg-surface-2 px-4 py-3.5 target:ring-2 target:ring-lime">
                  <dt className="text-[15px] font-semibold">{t.t}</dt>
                  <dd className="mt-1 text-sm text-fg-2">{t.b}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card id="faq" className="scroll-mt-28 space-y-2">
            <h2 className="pb-1 text-xl font-semibold">{h.faq}</h2>
            {h.faqs.map((f) => (
              <details key={f.q} className="squircle group rounded-[18px] bg-surface-2 px-4 py-3.5">
                <summary className="flex cursor-pointer list-none items-center text-[15px] font-medium">
                  {f.q}
                  <span aria-hidden className="ml-auto text-lg text-fg-2 group-open:rotate-45 transition-transform">+</span>
                </summary>
                <p className="mt-2 text-sm text-fg-2">{f.a}</p>
              </details>
            ))}
          </Card>
          <Card id="revoke" className="scroll-mt-28 space-y-2">
            <h2 className="text-xl font-semibold">{h.revoke}</h2>
            <p className="text-[15px] text-fg-2">{h.revokeBody}</p>
            <p className="text-sm">
              {h.names.morpho}: <a className="break-all text-lime" href={`${explorer}/address/${external.morpho}`} target="_blank" rel="noreferrer">{external.morpho}</a>
            </p>
            <p className="text-sm">
              {h.names.router}: <a className="break-all text-lime" href={`${explorer}/address/${deployment.router}`} target="_blank" rel="noreferrer">{deployment.router}</a>
            </p>
          </Card>
          <Card id="contracts" className="scroll-mt-28 space-y-2">
            <h2 className="text-xl font-semibold">{h.contracts}</h2>
            <p className="pb-1 text-sm text-fg-2">{h.contractsBody}</p>
            <div className="divide-y divide-line">
              {contracts.map(([name, addr]) => (
                <p key={name + addr} className="flex flex-wrap gap-x-4 gap-y-1 py-2.5 text-sm">
                  <span className="text-fg-2">{name}</span>
                  <a className="ml-auto font-mono text-[13px] break-all text-fg hover:text-lime" href={`${explorer}/address/${addr}`} target="_blank" rel="noreferrer">
                    {addr}
                  </a>
                </p>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
