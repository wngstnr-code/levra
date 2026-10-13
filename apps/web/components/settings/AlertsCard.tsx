"use client";

import type { AlertSettings, AlertSettingsUpdate } from "@levra/shared/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Address } from "viem";
import { api } from "@/lib/api/client";
import { apiConfigured, shouldRetry } from "@/lib/api/hooks";
import { describeError } from "@/lib/contractErrors";
import { useT } from "@/lib/i18n";
import { useAlertsAuth } from "@/lib/useAlertsAuth";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Switch } from "../ui/Switch";

const WAD_PER_PCT = 10n ** 16n;

export function AlertsCard({ user }: { user: Address }) {
  const m = useT();
  const auth = useAlertsAuth(user, m.settings.siweStatement);
  const [authError, setAuthError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const alerts = useQuery({ queryKey: ["alerts", user, auth.token], queryFn: () => api("alertsGet", { token: auth.token! }), enabled: apiConfigured && !!auth.token, retry: shouldRetry });

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">{m.settings.alerts}</h2>
      {!apiConfigured ? (
        <p className="text-sm text-fg-2">{m.settings.alertsOffline}</p>
      ) : !auth.token ? (
        <div className="squircle flex flex-wrap items-center gap-3 rounded-panel bg-surface-2 px-4 py-3.5">
          <p className="min-w-0 flex-1 text-sm text-fg-2">{authError ?? m.settings.alertsSignIn}</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setAuthError(null);
              auth.signIn().catch((e: unknown) => setAuthError(describeError(e, m)));
            }}
          >
            {m.settings.alertsSignInButton}
          </Button>
        </div>
      ) : alerts.isError ? (
        <p className="text-sm text-down">{describeError(alerts.error, m)}</p>
      ) : !alerts.data ? (
        <p className="text-sm text-fg-2">{m.common.loading}</p>
      ) : (
        <AlertsForm key={JSON.stringify(alerts.data)} initial={alerts.data} save={(u) => api("alertsPut", { token: auth.token!, body: u })} onSaved={(d) => queryClient.setQueryData(["alerts", user, auth.token], d)} />
      )}
    </Card>
  );
}

function AlertsForm({ initial, save, onSaved }: { initial: AlertSettings; save: (u: AlertSettingsUpdate) => Promise<AlertSettings>; onSaved: (d: AlertSettings) => void }) {
  const m = useT();
  const [email, setEmail] = useState(initial.channels.email ?? "");
  const [events, setEvents] = useState(initial.events);
  const [ltvPct, setLtvPct] = useState(initial.events.ltvThresholdWad ? String(Number(BigInt(initial.events.ltvThresholdWad) / WAD_PER_PCT)) : "65");
  const mutation = useMutation({ mutationFn: save, onSuccess: onSaved });
  const pct = Number(ltvPct);
  const pctValid = Number.isInteger(pct) && pct > 0 && pct < 100;

  const toggle = (k: "preClose" | "autoDeleverage" | "liquidation" | "depositArrived") => setEvents((e) => ({ ...e, [k]: !e[k] }));
  const submit = () =>
    mutation.mutate({
      channels: { email: email.trim() || null },
      events: { ...events, ltvThresholdWad: events.ltvThresholdWad !== null && pctValid ? (BigInt(pct) * WAD_PER_PCT).toString() : events.ltvThresholdWad === null ? null : events.ltvThresholdWad },
    });

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="squircle block rounded-panel bg-surface-2 px-4 py-3">
          <span className="label-caps">{m.settings.email}</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={m.settings.emailPlaceholder} className="mt-1 block w-full bg-transparent text-[15px] font-medium outline-none placeholder:text-fg-3" />
        </label>
        <div className="squircle rounded-panel bg-surface-2 px-4 py-3">
          <span className="label-caps">{m.settings.telegram}</span>
          <p className="mt-1 text-[15px] font-medium">{initial.channels.telegramLinked ? m.settings.telegramLinked : m.settings.telegramNotLinked}</p>
        </div>
      </div>
      <p className="pt-2 text-sm font-semibold">{m.settings.sendWhen}</p>
      <Row label={m.settings.preClose} on={events.preClose} onClick={() => toggle("preClose")} />
      <div className="squircle flex items-center gap-3 rounded-[18px] bg-surface-2 px-4 py-3">
        <span className="flex-1 text-sm">{m.settings.ltvAbove}</span>
        <input aria-label={m.settings.ltvAbove} inputMode="numeric" value={ltvPct} onChange={(e) => setLtvPct(e.target.value)} disabled={events.ltvThresholdWad === null} className="w-14 rounded-lg bg-surface-3 px-2 py-1 text-right text-sm font-semibold outline-none disabled:opacity-40" />
        <span className="text-sm text-fg-2">%</span>
        <Switch
          on={events.ltvThresholdWad !== null}
          label={m.settings.ltvAbove}
          onClick={() => setEvents((e) => ({ ...e, ltvThresholdWad: e.ltvThresholdWad === null ? (BigInt(pctValid ? pct : 65) * WAD_PER_PCT).toString() : null }))}
        />
      </div>
      <Row label={m.settings.autoDeleverage} on={events.autoDeleverage} onClick={() => toggle("autoDeleverage")} />
      <Row label={m.settings.liquidation} on={events.liquidation} onClick={() => toggle("liquidation")} />
      <Row label={m.settings.depositArrived} on={events.depositArrived} onClick={() => toggle("depositArrived")} />
      {mutation.isError && <p className="text-sm text-down">{describeError(mutation.error, m)}</p>}
      <div className="flex items-center gap-3 pt-1">
        <Button onClick={submit} disabled={mutation.isPending || (events.ltvThresholdWad !== null && !pctValid)}>
          {mutation.isPending ? m.settings.saving : m.settings.save}
        </Button>
        {mutation.isSuccess && <span className="text-sm text-up">{m.settings.saved}</span>}
      </div>
    </>
  );
}

function Row({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <div className="squircle flex items-center gap-3 rounded-[18px] bg-surface-2 px-4 py-3">
      <span className="flex-1 text-sm">{label}</span>
      <Switch on={on} onClick={onClick} label={label} />
    </div>
  );
}
