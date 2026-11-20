import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseEther, type Address } from "viem";
import { grantLine, handoverLine, keysChain, parseKeysArgs, storeKey } from "../scripts/keys";
import { parseMoveArgs, remoteWrite } from "../scripts/move-variables";
import { ROLES, planTopUps } from "../scripts/roles";

const a = (n: number) => `0x${String(n).padStart(40, "0")}` as Address;

describe("keeper roles", () => {
  it("has one key per role, each granted by its own owner call", () => {
    expect(Object.keys(ROLES)).toEqual(["ORACLE_AGE_POSTER_KEY", "CALENDAR_POSTER_KEY", "PROTECTOR_KEY", "LIQUIDATOR_KEY"]);
    const d = { riskManager: a(1), router: a(2), liquidator: a(3) } as never;
    expect(ROLES.PROTECTOR_KEY.grant(d, a(9))).toBe(`cast send ${a(2)} "setKeeper(address,bool)" ${a(9)} true`);
    expect(ROLES.LIQUIDATOR_KEY.revoke(d, a(9))).toBe(`cast send ${a(3)} "setKeeper(address,bool)" ${a(9)} false`);
  });
});

describe("keys script arguments", () => {
  it("needs a secrets folder and known roles", () => {
    expect(parseKeysArgs(["--dir", "/keys-out", "PROTECTOR_KEY", "--confirm"])).toEqual({ dir: "/keys-out", roles: ["PROTECTOR_KEY"], confirm: true, replace: false });
    expect(() => parseKeysArgs(["PROTECTOR_KEY"])).toThrow(/--dir/);
    expect(() => parseKeysArgs(["--dir", "--confirm", "PROTECTOR_KEY"])).toThrow(/--dir/);
    expect(() => parseKeysArgs(["--dir", "/k", "OWNER_KEY"])).toThrow(/unknown: OWNER_KEY/);
    expect(() => parseKeysArgs(["--dir", "/k"])).toThrow(/Name one or more roles/);
  });

  it("works before our deployment on a chain, from CHAIN_ID, and prints the deploy variables", () => {
    expect(keysChain({ CHAIN_ID: "8453" })).toEqual({ chainId: 8453, deployment: null });
    expect(() => keysChain({})).toThrow(/Set DEPLOYMENT_FILE, or CHAIN_ID/);
    expect(() => keysChain({ CHAIN_ID: "1" })).toThrow(/CHAIN_ID/);
    expect(grantLine("LIQUIDATOR_KEY", a(9), null)).toBe(`LIQUIDATOR_KEEPER=${a(9)} in the deploy environment; the deploy grants it`);
    expect(handoverLine(196, [`KEEPER=${a(9)}`], false)).toBe(`For the owner (Wangsit), chain 196: KEEPER=${a(9)} set before the deployment of this chain`);
    expect(handoverLine(143, [`KEEPER=${a(9)}`], true)).toBe(`For the owner (Wangsit), chain 143: KEEPER=${a(9)} make set-roles-monad CONFIRM=yes`);
  });

  it("refuses a deployment file of another chain than CHAIN_ID", () => {
    const monadFile = new URL("../../../contracts/deployments/monad.json", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    expect(keysChain({ DEPLOYMENT_FILE: monadFile }).chainId).toBe(143);
    expect(() => keysChain({ DEPLOYMENT_FILE: monadFile, CHAIN_ID: "8453" })).toThrow(/is for chain 143, but CHAIN_ID is 8453/);
  });

  it("stores a key once, owner read only, and replaces it only on rotation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "levra-keys-"));
    await storeKey(dir, "PROTECTOR_KEY", "0xaa", false);
    expect(await readFile(join(dir, "PROTECTOR_KEY"), "utf8")).toBe("0xaa");
    if (process.platform !== "win32") expect((await stat(join(dir, "PROTECTOR_KEY"))).mode & 0o777).toBe(0o400);
    await expect(storeKey(dir, "PROTECTOR_KEY", "0xbb", false)).rejects.toThrow(/EEXIST/);
    // Windows cannot rename over a read-only file; the script runs on the Linux server.
    if (process.platform === "win32") return;
    await storeKey(dir, "PROTECTOR_KEY", "0xbb", true);
    expect(await readFile(join(dir, "PROTECTOR_KEY"), "utf8")).toBe("0xbb");
  });
});

describe("moving variables off Railway", () => {
  it("passes only plain names to the shells", () => {
    expect(parseMoveArgs(["--from", "keeper", "--to", "levra@203.0.113.7", "--service", "keeper-monad", "PROTECTOR_KEY", "TELEGRAM_BOT_TOKEN"])).toEqual({
      from: "keeper",
      to: "levra@203.0.113.7",
      service: "keeper-monad",
      names: ["PROTECTOR_KEY", "TELEGRAM_BOT_TOKEN"],
      confirm: false,
    });
    expect(() => parseMoveArgs(["--from", "keeper;rm -rf /", "--to", "h", "--service", "s", "A"])).toThrow(/plain name/);
    expect(() => parseMoveArgs(["--from", "k", "--to", "h", "--service", "s", "bad name"])).toThrow(/not variable names/);
    expect(() => parseMoveArgs(["--from", "k", "--to", "h", "--service", "s"])).toThrow(/Name the variables/);
  });

  it("writes on the server as the image user, owner read only, never over an existing file", () => {
    const command = remoteWrite("keeper-monad", "PROTECTOR_KEY");
    expect(command).toContain("--user 1000:1000");
    expect(command).toContain("--network none");
    expect(command).toContain("-v /opt/levra/secrets/keeper-monad:/out");
    expect(command).toContain("umask 0377; set -C; cat > /out/PROTECTOR_KEY");
  });
});

describe("MON top-ups", () => {
  const limits = { targetWei: parseEther("10"), maxPerWalletWei: parseEther("6"), maxTotalWei: parseEther("9") };
  it("fills the emptiest wallets first, up to the target, within the per-wallet and per-run caps", () => {
    const plan = planTopUps(
      [
        { role: "full", address: a(1), balanceWei: parseEther("12") },
        { role: "low", address: a(2), balanceWei: parseEther("7") },
        { role: "empty", address: a(3), balanceWei: 0n },
      ],
      limits,
    );
    expect(plan.map((p) => [p.role, p.sendWei])).toEqual([
      ["empty", parseEther("6")],
      ["low", parseEther("3")],
      ["full", 0n],
    ]);
  });

  it("stops at the per-run cap", () => {
    const plan = planTopUps([1, 2, 3].map((n) => ({ role: `r${n}`, address: a(n), balanceWei: 0n })), limits);
    expect(plan.map((p) => p.sendWei)).toEqual([parseEther("6"), parseEther("3"), 0n]);
  });
});
