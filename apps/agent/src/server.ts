import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { LevraApiError, type LevraApi } from "./api";

const INSTRUCTIONS = [
  "Levra is a margin account for tokenized US stocks on Monad (143), Base (8453) and X Layer (196): long with leverage, short, or lend USDC.",
  "This server reads markets and positions and prepares actions. It never holds keys and cannot sign or send anything.",
  "To act, call a levra_prepare_* tool and give the user the link: the user reviews the fresh quote in the Levra app and signs with their own wallet.",
  "Amounts are integers in base units as strings: USDC has 6 decimals; leverage is x100 (200 = 2x); fractionWad 1e18 = 100%.",
  "Prices and limits change quickly and stock markets have hours; quote again before advising, and never promise a price.",
  "On X Layer, answers carry Levra's TapeOut circuit checks: `circuit` on each position (health and soft limit), `circuitGapCheck` in an open quote (health after the worst weekend gap) and `clock` in the session.",
  "When asked about health or the market session there, say what the circuit answers and that anyone can check it onchain with `eval`. If `matches` is false, say the circuit and Levra's own numbers disagree; if the field is null, say the circuit could not answer.",
  "A prepared action on X Layer carries `circuitCheck`: `risk` (the position after the action), `gap` (opens only) and `clock`. Always show it with the link, before the user signs; it is a check, not a guarantee, and the contracts check again.",
].join(" ");

const chainId = z.union([z.literal(143), z.literal(8453), z.literal(196)]).describe("Chain ID: 143 Monad, 8453 Base, 196 X Layer.");

const json = (value: unknown): CallToolResult => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
const failure = (err: unknown): CallToolResult => {
  const message = err instanceof LevraApiError ? `${err.code}: ${err.message}` : "The request failed.";
  return { content: [{ type: "text", text: message }], isError: true };
};
const run = async (read: () => Promise<unknown>): Promise<CallToolResult> => {
  try {
    return json(await read());
  } catch (err) {
    return failure(err);
  }
};

// Plain string schemas, since MCP clients get JSON Schema; the API checks every request against the shared zod schema.
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe("Wallet address, 0x followed by 40 hex digits.");
const marketId = z.string().regex(/^0x[0-9a-fA-F]{64}$/).describe("Levra market ID from levra_account or levra_markets.");
const raw = (what: string) => z.string().regex(/^(0|[1-9][0-9]*)$/).describe(what);
const symbol = z.string().regex(/^[A-Z][A-Z0-9.]{0,9}$/).describe("Stock symbol, for example NVDA or QQQ.");
const slippageBps = z.number().int().min(0).max(10_000).describe("Most price slippage accepted, in basis points (50 = 0.5%).");
const user = address.describe("The user's wallet, the one that will sign.");

const openShape = {
  user,
  symbol,
  side: z.enum(["long", "short"]),
  marginRaw: raw("Margin in USDC base units (6 decimals): 100 USDC is 100000000."),
  leverageE2: z.number().int().positive().describe("Leverage x100: 200 is 2x."),
  slippageBps,
};
const closeShape = { user, marketId, fractionWad: raw("Part to close, 1e18 = all: half is 500000000000000000."), slippageBps };
const collateralShape = {
  user,
  marketId,
  action: z.enum(["add", "remove", "repay"]).describe("add or remove collateral, or repay debt."),
  amountRaw: raw("Amount in the token's base units: USDC has 6 decimals; stock decimals are in levra_markets."),
};

/**
 * A quote's transaction and signature requests are dropped: the agent never hands out something to sign. Signing happens
 * only in the Levra app from a prepared link, after the app quotes again behind the user's own region and terms gate.
 */
function withoutSignables(quote: unknown): unknown {
  if (typeof quote !== "object" || quote === null) return quote;
  const { tx: _tx, requirements: _requirements, ...rest } = quote as Record<string, unknown>;
  return rest;
}

/** The Levra MCP server (BE-77). Every tool is a call to the public API; see INSTRUCTIONS for what the model is told. */
export function createLevraServer(api: LevraApi): McpServer {
  const server = new McpServer({ name: "levra", version: "1.0.0" }, { instructions: INSTRUCTIONS });
  const readOnly = { readOnlyHint: true, openWorldHint: true } as const;

  server.registerTool("levra_chains", { description: "The chains Levra knows and which ones are live.", annotations: readOnly }, () => run(() => api.get("/v1/chains")));

  server.registerTool(
    "levra_markets",
    { description: "Every stock market on a chain: price, market session, borrow rates and limits.", inputSchema: { chainId }, annotations: readOnly },
    ({ chainId }) => run(() => api.get(`/v1/${chainId}/markets`)),
  );

  server.registerTool(
    "levra_market",
    { description: "One stock on a chain in detail: depth, rate history and price deviation.", inputSchema: { chainId, symbol }, annotations: readOnly },
    ({ chainId, symbol }) => run(() => api.get(`/v1/${chainId}/markets/${encodeURIComponent(symbol)}`)),
  );

  server.registerTool(
    "levra_account",
    {
      description: "A wallet's positions on a chain: size, debt ratio, liquidation price, profit and loss, and totals. On X Layer each position also has the TapeOut risk circuit's answer (`circuit`).",
      inputSchema: { chainId, address },
      annotations: readOnly,
    },
    ({ chainId, address }) => run(() => api.get(`/v1/${chainId}/accounts/${address}`)),
  );

  server.registerTool(
    "levra_session",
    { description: "The US market session on a chain now, and the next close and open. On X Layer also the Wall Street Clock circuit's session (`clock`).", inputSchema: { chainId }, annotations: readOnly },
    ({ chainId }) => run(() => api.get(`/v1/${chainId}/session`)),
  );

  const quoteTools = [
    ["open", "Preview opening a long or short: size, debt, liquidation price, fees and warnings.", openShape],
    ["close", "Preview closing part or all of a position (fractionWad 1e18 = all): USDC back and warnings.", closeShape],
    ["collateral", "Preview adding or removing collateral, or repaying debt: debt ratio and liquidation price after.", collateralShape],
  ] as const;
  type Args = { chainId: number } & Record<string, unknown>;
  for (const [kind, description, shape] of quoteTools) {
    server.registerTool(
      `levra_quote_${kind}`,
      { description: `${description} Read only; nothing is sent.`, inputSchema: { chainId, ...shape }, annotations: readOnly },
      ({ chainId, ...request }: Args) => run(async () => withoutSignables(await api.post(`/v1/${chainId}/quote/${kind}`, request))),
    );
    server.registerTool(
      `levra_prepare_${kind}`,
      {
        description: `Prepare this action for the user to sign in the Levra app. Returns a link and a one-line summary; the link works for an hour and the app quotes again before signing. On X Layer also the TapeOut circuits' check of the action (\`circuitCheck\`).`,
        inputSchema: { chainId, ...shape },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      ({ chainId, ...request }: Args) => run(() => api.post(`/v1/${chainId}/agent/prepare`, { kind, request })),
    );
  }
  return server;
}
