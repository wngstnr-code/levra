import { chains, isChainId, type ChainId } from "@levra/shared/chains";
import { z } from "zod";

/** HyperSync hosts verified for our chains. Base and X Layer are not verified yet, so they use the RPC unless HYPERSYNC_URL is set. */
const hyperSyncByChain: Partial<Record<ChainId, string>> = { 143: "https://monad.hypersync.xyz" };

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.url(),
    /** The chain this process indexes (BE-95): 143 Monad, 8453 Base, 196 X Layer. One process per chain. */
    CHAIN_ID: z.coerce
      .number()
      .int()
      .refine(isChainId, { message: `must be one of ${Object.keys(chains).join(", ")}` })
      .default(143),
    /** RPC endpoint of CHAIN_ID. MONAD_RPC_URL is still read for chain 143. */
    RPC_URL: z.url().optional(),
    MONAD_RPC_URL: z.url().optional(),
    /** contracts/deployments/<environment>.json, written by the deployment script. Its chainId must equal CHAIN_ID. */
    DEPLOYMENT_FILE: z.string().min(1),
    /** Envio HyperSync is the log source when a token and a HyperSync address for the chain are set; otherwise the RPC endpoint is. */
    ENVIO_API_TOKEN: z.string().optional(),
    HYPERSYNC_URL: z.url().optional(),
    /** Blocks per eth_getLogs call when the RPC endpoint is the source: 100 for rpc.xlayer.tech. */
    LOG_BLOCK_RANGE: z.coerce.number().int().positive().default(10_000),
    POLL_MS: z.coerce.number().int().positive().default(2_000),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  })
  .transform((e, ctx) => {
    const chainId = e.CHAIN_ID as ChainId;
    const rpcUrl = e.RPC_URL ?? (chainId === 143 ? e.MONAD_RPC_URL : undefined);
    if (!rpcUrl) {
      ctx.addIssue({ code: "custom", path: ["RPC_URL"], message: `RPC_URL is needed for chain ${chainId}` });
      return z.NEVER;
    }
    return { ...e, CHAIN_ID: chainId, rpcUrl, hyperSyncUrl: e.HYPERSYNC_URL ?? hyperSyncByChain[chainId] };
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // A variable left empty on the host counts as not set, so its default applies instead of failing the start.
  const set = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ""));
  const parsed = envSchema.safeParse(set);
  if (!parsed.success) throw new Error(`Invalid environment: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
