import { z } from "zod";

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
