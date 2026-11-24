"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { api, ApiRequestError } from "@/lib/api/client";
import { apiConfigured, shouldRetry } from "@/lib/api/hooks";
import { chainPath, webChainById } from "@/lib/chains";
import { describeError } from "@/lib/contractErrors";
import { shortAddress } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { preparedPath, sameWallet } from "@/lib/prepared";
import { formatDuration } from "@/lib/units";
import { useNowSeconds } from "@/lib/useNow";
import { useSignIn } from "../SignIn";
import { LevraIcon } from "../icons/LevraIcon";
import { Button, ButtonLink } from "../ui/Button";
import { Card } from "../ui/Card";
import { EmptyState } from "../ui/EmptyState";
import { Skeleton } from "../ui/Skeleton";

/** The page an agent's link opens (BE-77, FE-77): what was prepared, for whom, and a way into the usual signing screen. */
export function PreparedView({ id }: { id: string }) {
  const m = useT();
  const a = m.agent;
  const now = useNowSeconds();
  const { address } = useAccount();
  const signIn = useSignIn();
  const prepared = useQuery({ queryKey: ["prepared", id], queryFn: ({ signal }) => api("prepared", { params: { id }, signal }), enabled: apiConfigured, retry: shouldRetry });

  const header = <h1 className="text-display pt-2 pb-4 text-[40px] leading-tight font-semibold">{a.title}</h1>;

  if (!apiConfigured) return <div className="space-y-4">{header}<EmptyState glyph="!" title={m.status.offlineTitle} body={m.common.notAvailable} /></div>;
  if (prepared.isPending) return <div className="space-y-4">{header}<Skeleton className="h-56 w-full rounded-card" /><p className="sr-only">{a.loading}</p></div>;
  if (prepared.isError) {
    const code = prepared.error instanceof ApiRequestError ? prepared.error.code : null;
    const body = code === "NOT_FOUND" ? a.notFound : code === "QUOTE_EXPIRED" ? a.expired : describeError(prepared.error, m);
    return <div className="space-y-4">{header}<EmptyState glyph="!" title={m.common.notAvailable} body={body} /></div>;
  }

  const p = prepared.data;
  const chain = webChainById(p.chainId);
  const expired = p.expiresAt <= now;
  const mine = sameWallet(address, p.user);

  return (
    <div className="space-y-4">
      {header}
      <Card className="flex max-w-[560px] flex-col gap-4">
        <div className="flex items-center gap-3">
          <LevraIcon name="verified" size={22} className="text-lime-text" />
          <p className="font-semibold">{a.kinds[p.kind]}</p>
          {chain && <span className="ml-auto rounded-full bg-surface-3 px-2.5 py-1 text-xs font-medium text-fg-2">{chain.name}</span>}
        </div>
        <p className="text-[15px]">{p.summary}</p>
        <p className="text-[13px] text-fg-2">{a.body}</p>
        <p className="text-xs text-fg-3">{expired ? a.expired : a.expires(formatDuration(p.expiresAt - now))}</p>
        {!chain || expired ? null : !address ? (
          <>
            <p className="text-sm text-fg-2">{a.signIn}</p>
            {signIn && <Button onClick={signIn}>{m.wallet.signIn}</Button>}
          </>
        ) : !mine ? (
          <p className="text-sm font-semibold text-caution">{a.wrongWallet(shortAddress(p.user))}</p>
        ) : (
          <ButtonLink href={chainPath(chain, preparedPath(p))}>{a.review}</ButtonLink>
        )}
      </Card>
    </div>
  );
}
