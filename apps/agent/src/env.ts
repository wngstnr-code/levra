import { z } from "zod";

const envSchema = z.object({
  /** The Levra API. On the server this is the internal address (http://api:8787), never the public one. */
  LEVRA_API_URL: z.url(),
  PORT: z.coerce.number().int().positive().default(8790),
  /**
   * The header our proxy writes with the caller's address, the same value as TRUST_PROXY_HEADER in api.env. The agent
   * passes the caller's address on under this name, so the API rate limits each caller and not the agent as a whole.
   */
  CLIENT_IP_HEADER: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .optional(),
});

export type AgentEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AgentEnv {
  const set = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ""));
  const parsed = envSchema.safeParse(set);
  if (!parsed.success) throw new Error(`Invalid environment: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
