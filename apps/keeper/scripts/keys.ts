import { readDeployment } from "@levra/shared/deployments/node";
import { existsSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { ROLES, SET_ROLES_ENV, isRoleName, type RoleName } from "./roles";

/**
 * Creates keeper keys and writes each one as a secret file of the keeper on the VPS (BE-55, docs/hosting.md). A private
 * key is never printed or passed on a command line. Only the addresses and the owner calls that grant the roles are
 * printed. On the server it runs through deploy/keys.sh, which mounts the keeper's secrets folder at --dir.
 *
 *   tsx scripts/keys.ts --dir <secrets folder> ORACLE_AGE_POSTER_KEY CALENDAR_POSTER_KEY PROTECTOR_KEY LIQUIDATOR_KEY [--replace] [--confirm]
 *
 * Without --confirm it only shows what it would do. An existing key is kept unless --replace is given (rotation).
 * Needs DEPLOYMENT_FILE for the contract addresses.
 */

export type KeysArgs = { dir: string; roles: RoleName[]; confirm: boolean; replace: boolean };

export function parseKeysArgs(args: string[]): KeysArgs {
  const dirAt = args.indexOf("--dir");
  const dir = dirAt >= 0 ? args[dirAt + 1] : undefined;
  if (!dir || dir.startsWith("--")) throw new Error("Name the secrets folder with --dir");
  const names = args.filter((a, i) => !a.startsWith("--") && i !== dirAt + 1);
  const unknown = names.filter((r) => !isRoleName(r));
  if (names.length === 0 || unknown.length > 0) throw new Error(`Name one or more roles: ${Object.keys(ROLES).join(", ")}${unknown.length ? ` (unknown: ${unknown.join(", ")})` : ""}`);
  return { dir, roles: names as RoleName[], confirm: args.includes("--confirm"), replace: args.includes("--replace") };
}

/** Writes the key readable by its owner only. A rotation writes a new file first, so a crash never leaves a half key. */
export async function storeKey(dir: string, role: RoleName, key: string, replace: boolean): Promise<void> {
  const path = join(dir, role);
  if (!replace) {
    await writeFile(path, key, { mode: 0o400, flag: "wx" });
    return;
  }
  const next = `${path}.new`;
  await writeFile(next, key, { mode: 0o400, flag: "wx" });
  await rename(next, path);
}

async function main() {
  const { dir, roles, confirm, replace } = parseKeysArgs(process.argv.slice(2));
  if (!existsSync(dir)) throw new Error(`${dir} does not exist`);
  const deploymentFile = process.env.DEPLOYMENT_FILE;
  if (!deploymentFile) throw new Error("DEPLOYMENT_FILE is not set");
  const deployment = readDeployment(deploymentFile);

  const lines: string[] = [];
  const handover: string[] = [];
  for (const role of roles) {
    if (existsSync(join(dir, role)) && !replace) {
      lines.push(`${role}: already in ${dir}, kept (use --replace to rotate)`);
      continue;
    }
    const key = generatePrivateKey();
    const address = privateKeyToAddress(key);
    if (confirm) await storeKey(dir, role, key, replace);
    lines.push(`${role} (${ROLES[role].label}): ${address}${confirm ? "" : "  [dry run, nothing stored]"}`);
    lines.push(`  grant: ${ROLES[role].grant(deployment, address)}`);
    handover.push(`${SET_ROLES_ENV[role]}=${address}`);
  }
  console.log(lines.join("\n"));
  if (handover.length > 0) {
    const grant = deployment.chainId === 143 ? "make set-roles-monad CONFIRM=yes" : "the grant calls above";
    console.log(`\nFor the owner (Wangsit), chain ${deployment.chainId}: ${handover.join(" ")} ${grant}`);
  }
  console.log(confirm ? `\nStored in ${dir}. Grant the roles on chain (owner or multisig), fund each address with gas, then restart the keeper.` : "\nDry run. Add --confirm to create and store the keys.");
}

if (process.argv[1]?.endsWith("keys.ts")) await main();
