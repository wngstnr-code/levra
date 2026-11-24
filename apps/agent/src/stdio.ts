import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createLevraApi } from "./api";
import { loadEnv } from "./env";
import { createLevraServer } from "./server";

/** For a local MCP client (Claude Desktop, Cursor): `LEVRA_API_URL=... pnpm --filter @levra/agent stdio`. */
const env = loadEnv();
await createLevraServer(createLevraApi(env.LEVRA_API_URL)).connect(new StdioServerTransport());
