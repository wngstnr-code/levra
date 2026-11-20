"use client";

import type { SessionInfo, SessionName } from "@levra/shared/api";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { dayProgress, segmentShare, sessionSegments } from "@/lib/sessionBar";
import { formatDuration } from "@/lib/units";
import { useNowSeconds } from "@/lib/useNow";
import { LevraIcon } from "../icons/LevraIcon";
import { Card } from "../ui/Card";

const labelColor: Record<SessionName, string> = { REGULAR: "text-up", PRE_MARKET: "text-caution", POST_MARKET: "text-caution", OVERNIGHT: "text-lilac-text", CLOSED: "text-fg-3", UNKNOWN: "text-fg-3" };
const segColor: Record<string, string> = { PRE_MARKET: "bg-butter", REGULAR: "bg-up", POST_MARKET: "bg-butter", OVERNIGHT: "bg-peri" };

/** The US session as a day bar with a countdown to the next weekly close or open. */
export function MarketClock({ session, info }: { session: SessionName | null; info: Pick<SessionInfo, "nextCloseAt" | "nextOpenAt" | "closedRegime"> | null }) {
  const m = useT();
  const now = useNowSeconds();
  const closeIn = info?.nextCloseAt && info.nextCloseAt > now ? info.nextCloseAt - now : null;
  const openIn = info?.nextOpenAt && info.nextOpenAt > now ? info.nextOpenAt - now : null;
  const closed = session === "CLOSED";
  const countdown = closed ? (openIn !== null ? m.clock.opensIn(formatDuration(openIn)) : null) : closeIn !== null ? m.clock.closesIn(formatDuration(closeIn)) : null;
  const marker = Math.round(dayProgress(now) * 1000) / 10;

  return (
    <Card className="flex flex-col gap-5 md:flex-row md:items-center md:gap-8">
      <div className="min-w-[200px]">
        <p className={cn("label-caps", session && `!${labelColor[session]}`)}>{session ? m.session[session] : m.common.loading}</p>
        <p className="text-display mt-1 text-[26px] font-semibold tabular-nums">{countdown ?? "—"}</p>
      </div>
      {!closed && (
        <div className="min-w-0 flex-1" aria-hidden>
          <div className="relative flex h-2.5 gap-[3px]">
            {sessionSegments.map((s) => (
              <span key={s.key} className={cn("h-full rounded-full", segColor[s.key], session === s.key ? "" : "opacity-35")} style={{ width: `${segmentShare(s) * 100}%` }} />
            ))}
            <span className="absolute -top-1 h-[18px] w-[3px] -translate-x-1/2 rounded-full bg-fg" style={{ left: `${marker}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-fg-3">
            <span>4 AM</span>
            <span>9:30 AM</span>
            <span>4 PM</span>
            <span>8 PM</span>
            <span>4 AM ET</span>
          </div>
        </div>
      )}
      {info?.closedRegime && (
        <div className="flex max-w-[300px] items-start gap-3">
          <LevraIcon name="weekendGuard" className="mt-0.5 shrink-0 text-caution" />
          <p className="text-[13px] text-fg-2">{m.clock.weekendNote}</p>
        </div>
      )}
    </Card>
  );
}
