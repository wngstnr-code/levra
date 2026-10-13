import { z } from "zod";

const optional = () =>
  z
    .string()
    .optional()
    .transform((v) => v || undefined);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  MONAD_RPC_URL: z.url(),
  /** Blocks to read back on the first start of the oracle recorder. 4,000,000 blocks is about two weeks. */
  ORACLE_BACKFILL_BLOCKS: z.coerce.bigint().positive().default(4_000_000n),
  /** contracts/deployments/<environment>.json. Needed by keepers that act on our contracts. */
  DEPLOYMENT_FILE: optional(),
  /** Key of the oracle age poster role (BE-17). The job runs only when it is set. One key per role (BE-55). */
  ORACLE_AGE_POSTER_KEY: optional().pipe(z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional()),
  /** Key of the calendar poster role (BE-30). The job runs only when it is set. One key per role (BE-55). */
  CALENDAR_POSTER_KEY: optional().pipe(z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional()),
  /** Key of a router keeper for auto-deleverage (BE-31). The job runs only when it is set. One key per role (BE-55). */
  PROTECTOR_KEY: optional().pipe(z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional()),
  /** Key of a Liquidator keeper (BE-32). The bot runs only when it is set. One key per role (BE-55). */
  LIQUIDATOR_KEY: optional().pipe(z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional()),
  KYBER_BASE_URL: optional().pipe(z.url().optional()),
  /** Sent as x-client-id. Routes work with any value (05). */
  KYBER_CLIENT_ID: z.string().min(1).default("levra"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) throw new Error(`Invalid environment: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
