import { GAP_TABLE_SOURCE, gapTable } from "@levra/shared/gaps";
import { GlowButton } from "./GlowButton";

const pct = (bps: number) => `${(bps / 100).toFixed(1)}%`.replace("-", "−");

/** Weekend guard spotlight: a light section with tilted image panels, like the reference's spotlight. */
export function LandingSpotlight() {
  const worst = gapTable.NVDA.worstDropBps;
  return (
    <section className="relative overflow-hidden bg-[#eeebf7] py-[14vh] text-[#0a0a0b]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/landing/chain-monad.jpg" alt="" aria-hidden className="pointer-events-none absolute -top-[8%] -left-[6%] h-[80%] w-[38%] rotate-3 object-cover opacity-20" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/landing/chain-base.jpg" alt="" aria-hidden className="pointer-events-none absolute -top-[4%] -right-[4%] h-[42%] w-[36%] -rotate-6 object-cover opacity-35" />

      <div className="relative mx-auto grid max-w-[1440px] items-center gap-16 px-[10.3%] lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
        <div className="flex flex-col items-start gap-8">
          <div className="flex border-[3px] border-[#0a0a0b] font-[family-name:var(--font-league)] text-[34px] leading-none">
            <span className="bg-white px-3 py-1">LEVRA</span>
            <span className="bg-[#0a0a0b] px-3 py-1 text-white">WEEKEND GUARD</span>
          </div>
          <h2 className="font-[family-name:var(--font-league)] text-[clamp(72px,9vw,140px)] leading-[0.85] uppercase">
            The market closes &amp;
            <br />
            your token doesn&apos;t
          </h2>
          <div className="max-w-[620px] space-y-5 text-[19px] leading-[1.45]">
            <p>Stocks stop trading on Friday; their tokens keep moving. A few hours before the close, Levra lowers how much you can borrow, so a Monday gap is less likely to reach liquidation.</p>
            <p>Before you sign a long or a short, you see the worst Monday gap of the last five years for that stock, and what it would do to your position.</p>
          </div>
          <div className="mt-2 flex flex-wrap gap-6">
            <GlowButton href="/monad/help" label="How it works" w={176} />
            <GlowButton href="/monad/help#risks" label="Read the risks" w={176} />
          </div>
        </div>

        <div className="[perspective:1600px]">
          <div className="relative aspect-[1.45] overflow-hidden rounded-[24px] border-2 border-[#c7b6f2] shadow-[0_40px_80px_-30px_rgba(10,10,11,0.5)] [transform:rotateY(-14deg)_rotateZ(-4deg)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/landing/nvda.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-b from-black/10 to-black/85" />
            <div className="absolute inset-x-8 bottom-8 flex flex-col items-start gap-3 text-white">
              <p className="font-[family-name:var(--font-league)] text-[64px] leading-[0.85]">MONDAY GAP</p>
              <p className="font-[family-name:var(--font-dm-mono)] text-[12px] tracking-[0.1em] uppercase">
                Worst NVDA open, {GAP_TABLE_SOURCE.from.slice(0, 4)} to {GAP_TABLE_SOURCE.to.slice(0, 4)}: {pct(worst)}
              </p>
              <GlowButton href="/monad/help#risks" label="What's this" w={150} h={40} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
