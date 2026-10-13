"use client";

import { usePrivy } from "@privy-io/react-auth";
import { createContext, useContext } from "react";

const SignInContext = createContext<(() => void) | null>(null);

/** Gives the rest of the app a way to open sign-in. Only mounted inside Privy, so pages never call Privy hooks without it. */
export function PrivySignInProvider({ children }: { children: React.ReactNode }) {
  const { login } = usePrivy();
  return <SignInContext.Provider value={login}>{children}</SignInContext.Provider>;
}

/** Opens sign-in, or null when sign-in is not configured. */
export const useSignIn = () => useContext(SignInContext);
