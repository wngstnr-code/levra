import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  MONAD_RPC_URL: z.url(),
  /** contracts/deployments/<environment>.json, written by the deployment script. */
  DEPLOYMENT_FILE: z.string().min(1),
  /** Envio HyperSync is the log source when a token is set; otherwise the RPC endpoint is. */
  ENVIO_API_TOKEN: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  HYPERSYNC_URL: z.url().default("https://monad.hypersync.xyz"),
  POLL_MS: z.coerce.number().int().positive().default(2_000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) throw new Error(`Invalid environment: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
