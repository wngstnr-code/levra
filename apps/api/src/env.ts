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
  /** contracts/deployments/<environment>.json, written by the deployment script. */
  DEPLOYMENT_FILE: z.string().min(1),
  KYBER_BASE_URL: z.url().default("https://aggregator-api.kyberswap.com/monad/api/v1"),
  /** Sent as x-client-id. Routes work with any value (05); a registered id raises the rate limit. */
  KYBER_CLIENT_ID: z.string().min(1).default("levra"),
  /** Signs session tokens after a wallet sign-in (BE-33). Sign-in and alert routes are off without it. Never commit it. */
  AUTH_SECRET: optional().pipe(z.string().min(32).optional()),
  /** Host of the web app, which the sign-in message must name, for example app.levra.xyz. */
  AUTH_DOMAIN: optional(),
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
  /** Shown in /v1/status, for example the git commit of the deployed build. */
  APP_VERSION: z.string().min(1).default("dev"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) throw new Error(`Invalid environment: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
