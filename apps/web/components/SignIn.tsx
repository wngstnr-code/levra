"use client";

import { useLoginWithEmail, useLoginWithPasskey, usePrivy } from "@privy-io/react-auth";
import { ChevronRight, Mail, ScanFace, Wallet } from "lucide-react";
import { createContext, useCallback, useContext, useState } from "react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { Button } from "./ui/Button";
import { Sheet } from "./ui/Sheet";

const SignInContext = createContext<(() => void) | null>(null);

/** Gives the rest of the app a way to open sign-in. Only mounted inside Privy, so pages never call Privy hooks without it. */
export function PrivySignInProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  return (
    <SignInContext.Provider value={show}>
      {children}
      <SignInSheet open={open} onClose={() => setOpen(false)} onReopen={show} />
    </SignInContext.Provider>
  );
}

/** Opens sign-in, or null when sign-in is not configured. */
export const useSignIn = () => useContext(SignInContext);

/** Our own front for Privy: every option calls Privy, which creates and secures the wallet. */
function SignInSheet({ open, onClose, onReopen }: { open: boolean; onClose: () => void; onReopen: () => void }) {
  const m = useT();
  const s = m.signIn;
  const { login } = usePrivy();
  const { loginWithPasskey } = useLoginWithPasskey();
  const [emailOpen, setEmailOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => unknown) => async () => {
    setError(null);
    try {
      onClose();
      await fn();
    } catch {
      setError(s.failed);
      onReopen();
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={s.title}>
      <p className="text-sm text-fg-2">{s.sub}</p>
      {emailOpen ? (
        <EmailForm onDone={onClose} onBack={() => setEmailOpen(false)} />
      ) : (
        <div className="space-y-2">
          <Option highlight icon={<span aria-hidden className="size-4 rounded-[4px] bg-chain-base" />} title={s.baseAccount} sub={s.baseAccountSub} onClick={run(() => login({ loginMethods: ["wallet"] }))} />
          <Option icon={<Mail size={18} aria-hidden />} title={s.email} sub={s.emailSub} onClick={() => setEmailOpen(true)} />
          <Option icon={<ScanFace size={18} aria-hidden />} title={s.passkey} sub={s.passkeySub} onClick={run(() => loginWithPasskey())} />
          <Option icon={<Wallet size={18} aria-hidden />} title={s.wallet} sub={s.walletSub} onClick={run(() => login({ loginMethods: ["wallet"] }))} />
        </div>
      )}
      {error && <p role="alert" className="text-sm text-down">{error}</p>}
      <p className="text-xs text-fg-3">{s.privy}</p>
    </Sheet>
  );
}

function Option({ icon, title, sub, onClick, highlight = false }: { icon: React.ReactNode; title: string; sub: string; onClick: () => void; highlight?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn("flex w-full items-center gap-3.5 rounded-panel p-3.5 text-left transition-colors", highlight ? "bg-chain-base text-white hover:brightness-110" : "bg-surface-3 hover:brightness-110")}
    >
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-[10px]", highlight ? "bg-white" : "bg-surface-2")}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">{title}</span>
        <span className={cn("block text-[13px]", highlight ? "text-white/80" : "text-fg-3")}>{sub}</span>
      </span>
      <ChevronRight size={16} aria-hidden className={highlight ? "text-white" : "text-fg-3"} />
    </button>
  );
}

function EmailForm({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const m = useT();
  const s = m.signIn;
  const { sendCode, loginWithCode, state } = useLoginWithEmail();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const sent = state.status === "awaiting-code-input" || state.status === "submitting-code";
  const busy = state.status === "sending-code" || state.status === "submitting-code";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (!sent) await sendCode({ email: email.trim() });
      else {
        await loginWithCode({ code: code.trim() });
        onDone();
      }
    } catch {
      setError(sent ? s.badCode : s.failed);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block rounded-input bg-surface-3 px-4 py-3">
        <span className="label-caps block">{sent ? s.code : s.email}</span>
        {sent ? (
          <input autoFocus inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} className="mt-1 w-full bg-transparent text-lg outline-none" />
        ) : (
          <input autoFocus type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={m.settings.emailPlaceholder} className="mt-1 w-full bg-transparent text-lg outline-none" />
        )}
      </label>
      {sent && <p className="text-[13px] text-fg-2">{s.codeSent(email.trim())}</p>}
      {error && <p role="alert" className="text-sm text-down">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={onBack} className="flex-1">
          {m.common.cancel}
        </Button>
        <Button type="submit" disabled={busy || (sent ? code.trim().length < 6 : !email.includes("@"))} className="flex-1">
          {busy ? m.common.loading : sent ? s.verify : s.sendCode}
        </Button>
      </div>
    </form>
  );
}
