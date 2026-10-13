"use client";

import { useApiSession } from "@/lib/api/hooks";
import { useT } from "@/lib/i18n";
import { formatDuration } from "@/lib/units";
import { useNowSeconds } from "@/lib/useNow";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

/** The countdown to the next close. Inside the pre-close window it also says how many positions are above the new limit. */
export function PreCloseCard({ overCount, onReview }: { overCount: number; onReview: (() => void) | null }) {
  const m = useT();
  const session = useApiSession();
  const now = useNowSeconds();
  const s = session.data;
  if (!s) return null;
  const closing = s.session !== "CLOSED" && s.nextCloseAt !== null && s.nextCloseAt > now;
  const target = closing ? s.nextCloseAt : s.nextOpenAt;
  if (target === null || target <= now) return null;
  return (
    <Card tone="butter" className="flex flex-col gap-3.5">
      <p className="text-xs font-semibold tracking-wide text-ink/60 uppercase">{closing ? m.preClose.closesIn : m.preClose.opensIn}</p>
      <p className="font-rounded text-[56px] leading-none font-semibold tabular-nums">{formatDuration(target - now)}</p>
      <p className="text-sm text-ink/75">
        {s.closedRegime ? m.preClose.lowerNow : m.preClose.lowerSoon}
        {s.closedRegime && overCount > 0 ? ` ${m.preClose.over(overCount)}` : ""}
      </p>
      {s.closedRegime && overCount > 0 && onReview && (
        <Button onClick={onReview} className="mt-auto w-full bg-ink text-butter">
          {m.preClose.review}
        </Button>
      )}
    </Card>
  );
}
