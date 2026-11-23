import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { LevraApi } from "./api";
import { createLevraServer } from "./server";

/** Largest request body read, in bytes; a tool call is a few hundred. */
const MAX_BODY = 64 * 1024;

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error("too large");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export const sendJson = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
};

/**
 * Remote MCP over Streamable HTTP at `POST /mcp`, stateless: each request gets its own server and transport, so
 * nothing is kept between calls and any number of clients can connect. `GET /health` for the container check.
 */
export function createHttpHandler(apiFor: (forward: Record<string, string>) => LevraApi, clientIpHeader?: string) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path === "/health" && req.method === "GET") return sendJson(res, 200, { ok: true });
    if (path !== "/mcp") return sendJson(res, 404, { error: "not found" });
    if (req.method !== "POST") return sendJson(res, 405, { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      return sendJson(res, 400, { jsonrpc: "2.0", error: { code: -32700, message: "Parse error." }, id: null });
    }
    // Our proxy appends the address it saw, so the last entry is the one to trust (as in the API's rate limit).
    const raw = clientIpHeader ? req.headers[clientIpHeader] : undefined;
    const ip = (Array.isArray(raw) ? raw.join(",") : raw)?.split(",").at(-1)?.trim();
    const server = createLevraServer(apiFor(clientIpHeader && ip ? { [clientIpHeader]: ip } : {}));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  };
}
