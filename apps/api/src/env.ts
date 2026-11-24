import { z } from "zod";

/** An empty value counts as not set, so `.env.example` lines can stay in place. */
const optional = () =>
  z
    .string()
    .optional()
    .transform((v) => v || undefined);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8787),
  DATABASE_URL: z.url(),
  MONAD_RPC_URL: z.url(),
  /** contracts/deployments/<environment>.json, written by the deployment script. The Monad deployment the routes serve. */
  DEPLOYMENT_FILE: z.string().min(1),
  /**
   * Other chains (BE-95): a chain is loaded when both its RPC endpoint and its deployment file are set. Until the routes
   * take a chain (BE-70), only /v1/status reads them.
   */
  BASE_RPC_URL: optional().pipe(z.url().optional()),
  BASE_DEPLOYMENT_FILE: optional(),
  XLAYER_RPC_URL: optional().pipe(z.url().optional()),
  XLAYER_DEPLOYMENT_FILE: optional(),
  /** KyberSwap endpoint for Monad (the name is older than the other chains); Base uses KyberSwap's Base endpoint. */
  KYBER_BASE_URL: z.url().default("https://aggregator-api.kyberswap.com/monad/api/v1"),
  /** Sent as x-client-id. Routes work with any value (05). */
  KYBER_CLIENT_ID: z.string().min(1).default("levra"),
  /** KyberSwap gateway key for a higher rate limit (05), sent as X-Api-Key. Never commit it. */
  KYBER_API_KEY: optional(),
  /** 1inch Business API key (05). Base quotes leave 1inch out without it. Never commit it. */
  ONEINCH_API_KEY: optional(),
  /** OKX DEX API v6 key, secret and passphrase (05). X Layer quotes have no route without all three. Never commit them. */
  OKX_API_KEY: optional(),
  OKX_SECRET_KEY: optional(),
  OKX_API_PASSPHRASE: optional(),
  /** Signs session tokens after a wallet sign-in (BE-33). Sign-in and alert routes are off without it. Never commit it. */
  AUTH_SECRET: optional().pipe(z.string().min(32).optional()),
  /**
   * Hosts of the web app that a sign-in message may name, comma-separated; `*` stands for one dash-separated part, for
   * example app.levra.finance,levra-*-team.vercel.app,localhost:3000.
   */
  AUTH_DOMAIN: optional(),
  /** Web origins allowed to call the API from a browser, same pattern rules, for example https://app.levra.finance. */
  CORS_ORIGINS: optional(),
  /** Base URL of the web app, for example https://app.levra.finance. Agent links point there; the agent routes are off without it (BE-77). */
  WEB_APP_URL: optional().pipe(z.url().optional()),
  /** Username of the alert bot, without @. The Telegram link route is off without it. */
  TELEGRAM_BOT_USERNAME: optional(),
  /** Aurora Intents partner token (BE-40). Optional: without it the service adds its own 0.2% fee to every transfer. */
  INTENTS_JWT: optional(),
  /**
   * Terms version users must accept (BE-52). Region and terms routes are off without it, and the web app then cannot
   * pass its gate, so a deployment without terms cannot take new positions or deposits.
   */
  TERMS_VERSION: optional(),
  /** Request header with the visitor's ISO country, set by the CDN in front of the API, for example cf-ipcountry. */
  GEO_COUNTRY_HEADER: optional(),
  /** Comma-separated ISO 3166-1 alpha-2 codes to refuse, decided with counsel (X-10). Needs GEO_COUNTRY_HEADER. */
  BLOCKED_COUNTRIES: optional(),
  /** More codes refused on Base only, on top of BLOCKED_COUNTRIES (D-73). Needs GEO_COUNTRY_HEADER. */
  BASE_BLOCKED_COUNTRIES: optional(),
  /** More codes refused on X Layer only, on top of BLOCKED_COUNTRIES (D-73). Needs GEO_COUNTRY_HEADER. */
  XLAYER_BLOCKED_COUNTRIES: optional(),
  /** Request header with the visitor's region, for example cf-region-code (Cloudflare's visitor location headers). */
  GEO_REGION_HEADER: optional(),
  /** Comma-separated ISO 3166-2 codes to refuse, for example UA-43,UA-40 (D-42). Needs GEO_REGION_HEADER and GEO_COUNTRY_HEADER. */
  BLOCKED_REGIONS: optional(),
  /**
   * Header with the client address written by our own proxy, for example x-forwarded-for or cf-connecting-ip (BE-51).
   * Only set it when a proxy we control always writes it; otherwise clients could choose their own address.
   */
  TRUST_PROXY_HEADER: optional(),
  /** Shown in /v1/status, for example the git commit of the deployed build. */
  APP_VERSION: z.string().min(1).default("dev"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // A variable left empty on the host counts as not set, so its default applies instead of failing the start.
  const set = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ""));
  const parsed = envSchema.safeParse(set);
  if (!parsed.success) throw new Error(`Invalid environment: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
