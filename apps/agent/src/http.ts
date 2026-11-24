import { createServer } from "node:http";
import { createLevraApi } from "./api";
import { loadEnv } from "./env";
import { createHttpHandler, sendJson } from "./handler";

const env = loadEnv();
const handler = createHttpHandler((headers) => createLevraApi(env.LEVRA_API_URL, { headers }), env.CLIENT_IP_HEADER);
createServer((req, res) => {
  handler(req, res).catch(() => {
    if (!res.headersSent) sendJson(res, 500, { jsonrpc: "2.0", error: { code: -32603, message: "Internal error." }, id: null });
  });
}).listen(env.PORT, () => console.log(JSON.stringify({ msg: "agent listening", port: env.PORT })));
