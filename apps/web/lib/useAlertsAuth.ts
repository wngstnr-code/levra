"use client";

import { useCallback, useState } from "react";
import type { Address } from "viem";
import { createSiweMessage } from "viem/siwe";
import { useConfig } from "wagmi";
import { signMessage } from "wagmi/actions";
import { api } from "./api/client";
import { monad } from "./chain";

type Session = { token: string; expiresAt: number };
const KEY = "levra.alertsSession";

function load(address: Address | undefined): Session | null {
  if (!address) return null;
  try {
    const raw = sessionStorage.getItem(`${KEY}.${address.toLowerCase()}`);
    const s = raw ? (JSON.parse(raw) as Session) : null;
    return s && s.expiresAt > Date.now() / 1000 ? s : null;
  } catch {
    return null;
  }
}

/** Sign-in with Ethereum for the alert settings. The token lives for this browser tab only. */
export function useAlertsAuth(address: Address | undefined, statement: string) {
  const config = useConfig();
  const [session, setSession] = useState<Session | null>(() => load(address));
  const current = session ?? load(address);

  const signIn = useCallback(async () => {
    if (!address) return;
    const { nonce } = await api("authNonce");
    const message = createSiweMessage({ address, chainId: monad.id, domain: window.location.host, nonce, uri: window.location.origin, version: "1", statement, issuedAt: new Date() });
    const signature = await signMessage(config, { account: address, message });
    const res = await api("authSiwe", { body: { message, signature } });
    const s = { token: res.token, expiresAt: res.expiresAt };
    try {
      sessionStorage.setItem(`${KEY}.${address.toLowerCase()}`, JSON.stringify(s));
    } catch {
      // Without storage the token lasts until the page reloads.
    }
    setSession(s);
  }, [address, config, statement]);

  return { token: current?.token ?? null, signIn };
}
