"use client";

import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { formatLeverage } from "@/lib/units";
import { InfoLink } from "../ui/InfoLink";

export type ActionState =
  | { kind: "signIn"; onClick: () => void }
  | { kind: "disabled"; label: string }
  | { kind: "ready"; label: string; onClick: () => void };

type Props = {
  side: "long" | "short";
  onSide: (s: "long" | "short") => void;
  shortAvailable: boolean;
  marginText: string;
  onMargin: (v: string) => void;
  balanceText: string | null;
  onMax: (() => void) | null;
  leverageE2: number;
  onLeverage: (v: number) => void;
  minE2: number;
  maxE2: number;
  slippageBps: number;
  onSlippage: (v: number) => void;
  capShare: number | null;
  capText: string | null;
  firstTimeSignatures: number;
  notes: string[];
  action: ActionState;
};

const SLIPPAGES = [30, 50, 100];

export function OrderPanel(p: Props) {
  const m = useT();
  const long = p.side === "long";
  const quick = long ? [150, 200, 300] : [25, 50, 100];
  return (
    <section aria-label={m.trade.title} className={cn("squircle flex min-w-0 flex-col gap-4 self-start rounded-card p-6 text-ink", long ? "bg-lime" : "bg-peach")}>
      <div role="tablist" className="flex gap-1 rounded-full bg-ink/8 p-1">
        {(["long", "short"] as const).map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={p.side === s}
            disabled={s === "short" && !p.shortAvailable}
            onClick={() => p.onSide(s)}
            className={cn(
              "flex-1 rounded-full py-2.5 text-sm font-semibold transition-colors duration-200 ease-spring disabled:opacity-40",
              p.side === s ? (long ? "bg-ink text-lime" : "bg-ink text-peach") : "text-ink",
            )}
          >
            {s === "long" ? m.trade.long : m.trade.short}
          </button>
        ))}
      </div>

      <label className="squircle block rounded-[22px] border-[1.5px] border-ink p-5">
        <span className="flex text-xs font-semibold tracking-wide text-ink/60 uppercase">
          {m.trade.youPay}
          <span className="ml-auto">{long ? m.trade.margin : m.trade.collateral}</span>
        </span>
        <span className="mt-2 flex items-center gap-2">
          <input
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={p.marginText}
            onChange={(e) => p.onMargin(e.target.value)}
            className="text-display w-full min-w-0 bg-transparent text-[40px] leading-none font-semibold text-ink outline-none placeholder:text-ink/30"
          />
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-ink/10 py-1.5 pr-3 pl-1.5 text-sm font-semibold">
            <span aria-hidden className={cn("flex size-6 items-center justify-center rounded-full bg-ink text-xs", long ? "text-lime" : "text-peach")}>$</span>
            USDC
          </span>
        </span>
        {p.balanceText && (
          <span className="mt-2 flex text-[13px] text-ink/60">
            {m.common.balance(p.balanceText)}
            {p.onMax && (
              <button type="button" onClick={p.onMax} className="ml-1.5 font-semibold text-ink underline-offset-2 hover:underline">
                {m.common.max}
              </button>
            )}
          </span>
        )}
      </label>

      <div className="squircle flex flex-col gap-3 rounded-[22px] bg-ink/6 p-5">
        <div className="flex items-center">
          <span className="text-xs font-semibold tracking-wide text-ink/60 uppercase">{long ? m.trade.leverage : m.trade.shortSize}</span>
          <span className="font-rounded ml-auto text-[28px] font-semibold tabular-nums">{formatLeverage(p.leverageE2)}</span>
        </div>
        <input
          type="range"
          aria-label={long ? m.trade.leverage : m.trade.shortSize}
          min={p.minE2}
          max={Math.max(p.minE2, p.maxE2)}
          step={5}
          value={p.leverageE2}
          onChange={(e) => p.onLeverage(Number(e.target.value))}
          className="w-full accent-ink"
        />
        <div className="flex flex-wrap gap-2">
          {quick.filter((q) => q <= p.maxE2).map((q) => (
            <Chip key={q} active={p.leverageE2 === q} onClick={() => p.onLeverage(q)} long={long}>
              {formatLeverage(q).replace(".00", "")}
            </Chip>
          ))}
          <Chip active={p.leverageE2 === p.maxE2} onClick={() => p.onLeverage(p.maxE2)} long={long}>
            {`${m.common.max} ${formatLeverage(p.maxE2)}`}
          </Chip>
        </div>
      </div>

      <div className="flex items-center px-1 text-sm">
        <span className="text-ink/70">
          {m.trade.slippage}
          <InfoLink term="slippage" label={m.trade.slippage} />
        </span>
        <div className="ml-auto flex gap-1.5">
          {SLIPPAGES.map((s) => (
            <Chip key={s} active={p.slippageBps === s} onClick={() => p.onSlippage(s)} long={long}>
              {s / 100}%
            </Chip>
          ))}
        </div>
      </div>

      {p.capText && p.capShare !== null && (
        <div className="space-y-2 px-1">
          <p className="text-[13px] text-ink/70">{p.capText}</p>
          <div className="h-1.5 overflow-hidden rounded-full bg-ink/15">
            <div className="h-full rounded-full bg-ink transition-[width] duration-300 ease-spring" style={{ width: `${Math.round(Math.min(1, p.capShare) * 100)}%` }} />
          </div>
        </div>
      )}

      {!long && <p className="squircle rounded-[18px] bg-ink/6 p-4 text-[13px] leading-relaxed text-ink/75">{m.trade.shortExplain}</p>}

      {p.firstTimeSignatures > 0 && (
        <div className="squircle rounded-[18px] bg-ink/6 p-4">
          <p className="text-[13px] font-semibold">{m.trade.firstTime(p.firstTimeSignatures)}</p>
          <p className="mt-1 text-xs text-ink/60">{m.trade.firstTimeSub}</p>
        </div>
      )}

      {p.action.kind === "disabled" ? (
        <button disabled className="h-14 w-full rounded-full bg-ink/20 text-base font-semibold text-ink/60">
          {p.action.label}
        </button>
      ) : (
        <button
          onClick={p.action.onClick}
          className={cn("squircle h-14 w-full rounded-full bg-ink text-base font-semibold transition-transform duration-200 ease-spring active:scale-[0.97]", long ? "text-lime" : "text-peach")}
        >
          {p.action.kind === "signIn" ? m.trade.signInToTrade : p.action.label}
        </button>
      )}
      {p.notes.map((n) => (
        <p key={n} className="text-xs text-ink/65">
          {n}
        </p>
      ))}
    </section>
  );
}

function Chip({ active, onClick, long, children }: { active: boolean; onClick: () => void; long: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex-1 rounded-full px-3 py-1.5 text-[13px] font-semibold whitespace-nowrap transition-colors duration-200 ease-spring",
        active ? cn("bg-ink", long ? "text-lime" : "text-peach") : "border border-ink/25 text-ink hover:border-ink/50",
      )}
    >
      {children}
    </button>
  );
}

