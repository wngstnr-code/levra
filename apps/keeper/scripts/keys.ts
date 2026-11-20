import { isChainId, type ChainId } from "@levra/shared/chains";
import type { Deployment } from "@levra/shared/deployments";
import { readDeployment } from "@levra/shared/deployments/node";
import { existsSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Address } from "viem";
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
 * With DEPLOYMENT_FILE it prints the grant calls; without one (a chain we have not deployed on yet) it needs CHAIN_ID
 * and prints the addresses the owner sets before the deployment.
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

/**
 * How a new role address gets its role. Without a deployment (Base and X Layer before our deploy) the owner puts the
 * address in the deploy environment, and the deploy script grants it with the contracts.
 */
export function grantLine(role: RoleName, address: Address, deployment: Deployment | null): string {
  return deployment ? ROLES[role].grant(deployment, address) : `${SET_ROLES_ENV[role]}=${address} in the deploy environment; the deploy grants it`;
}

export function handoverLine(chainId: number, handover: string[], deployed: boolean): string {
  const grant = !deployed ? "set before the deployment of this chain" : chainId === 143 ? "make set-roles-monad CONFIRM=yes" : "the grant calls above";
  return `For the owner (Wangsit), chain ${chainId}: ${handover.join(" ")} ${grant}`;
}

/** The chain of the keys: the deployment's, or CHAIN_ID when nothing is deployed there yet. */
export function keysChain(env: NodeJS.ProcessEnv): { chainId: ChainId; deployment: Deployment | null } {
  const deployment = env.DEPLOYMENT_FILE ? readDeployment(env.DEPLOYMENT_FILE) : null;
  const chainId = deployment?.chainId ?? Number(env.CHAIN_ID);
  if (!isChainId(chainId)) throw new Error("Set DEPLOYMENT_FILE, or CHAIN_ID (143, 8453 or 196) when the chain has no deployment yet");
  if (env.CHAIN_ID && Number(env.CHAIN_ID) !== chainId) throw new Error(`DEPLOYMENT_FILE is for chain ${chainId}, but CHAIN_ID is ${env.CHAIN_ID}`);
  return { chainId, deployment };
}

async function main() {
  const { dir, roles, confirm, replace } = parseKeysArgs(process.argv.slice(2));
  if (!existsSync(dir)) throw new Error(`${dir} does not exist`);
  const { chainId, deployment } = keysChain(process.env);

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
    lines.push(`  grant: ${grantLine(role, address, deployment)}`);
    handover.push(`${SET_ROLES_ENV[role]}=${address}`);
  }
  console.log(lines.join("\n"));
  if (handover.length > 0) console.log(`\n${handoverLine(chainId, handover, deployment !== null)}`);
  console.log(confirm ? `\nStored in ${dir}. Grant the roles on chain (owner or multisig), fund each address with gas, then restart the keeper.` : "\nDry run. Add --confirm to create and store the keys.");
}

if (process.argv[1]?.endsWith("keys.ts")) await main();
