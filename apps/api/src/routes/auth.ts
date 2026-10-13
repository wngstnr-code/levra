import { authNonces, type Db } from "@levra/db";
import { siweRequest, type AuthNonceResponse, type SiweResponse } from "@levra/shared/api";
import { and, eq, gte, isNull } from "drizzle-orm";
import { Hono, type Context, type Next } from "hono";
import { randomBytes } from "node:crypto";
import { getAddress, type Address, type PublicClient } from "viem";
import { parseSiweMessage } from "viem/siwe";
import { signToken, verifyToken } from "../auth/token";
import { ApiHttpError, upstream } from "../errors";

/** Initial proposals: a nonce is good for 10 minutes, a session for 24 hours. */
export const NONCE_TTL_SECONDS = 600;
export const SESSION_TTL_SECONDS = 86_400;

export type AuthOptions = {
  /** At least 32 characters. Signs the session tokens. */
  secret: string;
  /** The web app's host, which the sign-in message must name (EIP-4361). */
  domain: string;
  chainId: number;
};

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** Sign-In with Ethereum (EIP-4361). Smart wallets work too: viem checks ERC-1271 and ERC-6492 signatures on chain. */
export function authRoutes(client: PublicClient, db: Db, opts: AuthOptions) {
  const app = new Hono();

  app.get("/v1/auth/nonce", async (c) => {
    const nonce = randomBytes(16).toString("hex");
    await upstream(() => db.insert(authNonces).values({ nonce, createdAt: new Date() }));
    return c.json({ nonce } satisfies AuthNonceResponse);
  });

  app.post("/v1/auth/siwe", async (c) => {
    const parsed = siweRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new ApiHttpError("BAD_REQUEST", "Expected a message and a signature.");
    const { message, signature } = parsed.data;
    const fields = parseSiweMessage(message);
    if (!fields.address || !fields.nonce) throw new ApiHttpError("BAD_REQUEST", "Not a sign-in message.");
    if (fields.domain !== opts.domain || fields.chainId !== opts.chainId) throw new ApiHttpError("UNAUTHORIZED", "The message is for another site or network.");

    const valid = await upstream(() => client.verifySiweMessage({ message, signature, domain: opts.domain, nonce: fields.nonce }));
    if (!valid) throw new ApiHttpError("UNAUTHORIZED", "The signature does not match the message.");

    // Used once, and only while fresh. Marked used only after the signature checks out.
    const [used] = await upstream(() =>
      db
        .update(authNonces)
        .set({ usedAt: new Date() })
        .where(and(eq(authNonces.nonce, fields.nonce!), isNull(authNonces.usedAt), gte(authNonces.createdAt, new Date((nowSeconds() - NONCE_TTL_SECONDS) * 1000))))
        .returning({ nonce: authNonces.nonce }),
    );
    if (!used) throw new ApiHttpError("UNAUTHORIZED", "The sign-in nonce is unknown, used or expired. Ask for a new one.");

    const expiresAt = nowSeconds() + SESSION_TTL_SECONDS;
    return c.json({ token: signToken(opts.secret, getAddress(fields.address), expiresAt), expiresAt } satisfies SiweResponse);
  });

  return app;
}

export type AuthVariables = { wallet: Address };

/** Requires `Authorization: Bearer <token>` and puts the wallet in `c.var.wallet`. */
export function requireWallet(secret: string) {
  return async (c: Context<{ Variables: AuthVariables }>, next: Next) => {
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const wallet = token ? verifyToken(secret, token, nowSeconds()) : null;
    if (!wallet) throw new ApiHttpError("UNAUTHORIZED", "Sign in with your wallet first.");
    c.set("wallet", wallet);
    await next();
  };
}
