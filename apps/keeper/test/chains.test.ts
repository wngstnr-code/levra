import { fileURLToPath } from "node:url";
import pino from "pino";
import type { PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/env";
import { createJobs } from "../src/jobs";

const base = { DATABASE_URL: "postgres://u:p@localhost:5432/db" };
const logger = pino({ level: "silent" });
const names = (env: NodeJS.ProcessEnv) => createJobs(loadEnv(env), {} as PublicClient, logger).map((j) => j.name);

describe("one keeper per chain (BE-95)", () => {
  it("defaults to Monad and still reads MONAD_RPC_URL there", () => {
    const env = loadEnv({ ...base, MONAD_RPC_URL: "https://rpc.monad.example" });
    expect(env).toMatchObject({ CHAIN_ID: 143, rpcUrl: "https://rpc.monad.example", KEEPER_GLOBAL: false });
  });

  it("needs RPC_URL for Base and X Layer, and refuses an unknown chain", () => {
    expect(() => loadEnv({ ...base, CHAIN_ID: "8453", MONAD_RPC_URL: "https://rpc.monad.example" })).toThrow(/RPC_URL is needed for chain 8453/);
    expect(loadEnv({ ...base, CHAIN_ID: "196", RPC_URL: "https://rpc.xlayer.example" })).toMatchObject({ CHAIN_ID: 196, rpcUrl: "https://rpc.xlayer.example" });
    expect(() => loadEnv({ ...base, CHAIN_ID: "1", RPC_URL: "https://rpc.example" })).toThrow(/CHAIN_ID/);
  });

  it("runs the Anchored jobs on Monad only, market depth on every chain, and the jobs for every chain only in the global keeper", () => {
    expect(names({ ...base, MONAD_RPC_URL: "https://rpc.monad.example" })).toEqual(["oracleMonitor", "marketDepth"]);
    expect(names({ ...base, MONAD_RPC_URL: "https://rpc.monad.example", KEEPER_GLOBAL: "1" })).toEqual(["oracleMonitor", "marketDepth", "transfers"]);
    // Base and X Layer run the Chainlink price recorder (BE-97), with no key and no deployment, and measure their DEX
    // mid price (BE-96; X Layer on Uniswap alone without the OKX keys, BE-81).
    expect(names({ ...base, CHAIN_ID: "8453", RPC_URL: "https://rpc.base.example" })).toEqual(["oracleMonitor", "marketDepth"]);
    expect(names({ ...base, CHAIN_ID: "196", RPC_URL: "https://rpc.xlayer.example" })).toEqual(["oracleMonitor", "marketDepth"]);
    expect(names({ ...base, CHAIN_ID: "8453", RPC_URL: "https://rpc.base.example", KEEPER_GLOBAL: "1" })).toEqual(["oracleMonitor", "marketDepth", "transfers"]);
  });

  it("refuses a deployment file of another chain", () => {
    const monadFile = fileURLToPath(new URL("../../../contracts/deployments/monad.json", import.meta.url));
    expect(() => names({ ...base, CHAIN_ID: "8453", RPC_URL: "https://rpc.base.example", DEPLOYMENT_FILE: monadFile })).toThrow(/is for chain 143, but CHAIN_ID is 8453/);
  });
});
