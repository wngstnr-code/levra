import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/env";

const base = { DATABASE_URL: "postgres://u:p@localhost:5432/levra", MONAD_RPC_URL: "https://rpc2.monad.xyz", DEPLOYMENT_FILE: "monad.json" };

describe("environment", () => {
  it("treats a variable left empty on the host as not set, so its default applies", () => {
    const env = loadEnv({ ...base, APP_VERSION: "", LOG_LEVEL: "  ", KYBER_CLIENT_ID: "", AUTH_SECRET: "" });
    expect(env).toMatchObject({ APP_VERSION: "dev", LOG_LEVEL: "info", KYBER_CLIENT_ID: "levra" });
    expect(env.AUTH_SECRET).toBeUndefined();
  });

  it("still refuses a value that is set but wrong, such as a placeholder", () => {
    expect(() => loadEnv({ ...base, MONAD_RPC_URL: "<paid RPC URL>" })).toThrow(/MONAD_RPC_URL/);
    expect(() => loadEnv({ ...base, AUTH_SECRET: "too short" })).toThrow(/AUTH_SECRET/);
  });
});