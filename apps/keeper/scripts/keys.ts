import { readDeployment } from "@levra/shared/deployments/node";
import { spawn } from "node:child_process";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { ROLES, SET_ROLES_ENV, isRoleName, type RoleName } from "./roles";

/**
 * Creates keeper keys and stores them straight in the keeper service's variables on Railway (BE-55). A private key is
 * never printed, written to a file or passed on a command line: it goes to the Railway CLI through stdin. Only the
 * addresses and the owner calls that grant the roles are printed.
 *
 *   tsx scripts/keys.ts ORACLE_AGE_POSTER_KEY CALENDAR_POSTER_KEY PROTECTOR_KEY LIQUIDATOR_KEY [--service keeper] [--replace] [--confirm]
 *
 * Without --confirm it only shows what it would do. An existing key is kept unless --replace is given (rotation).
 * Needs DEPLOYMENT_FILE for the contract addresses and a Railway CLI linked to the project.
 */

const RAILWAY = process.env.RAILWAY_BIN ?? "railway";

function railway(args: string[], stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // A shell finds the npm shim on Windows; nothing secret is on the command line.
    const child = spawn(RAILWAY, args, { shell: process.platform === "win32", stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`railway ${args[0]} ${args[1] ?? ""} failed: ${err.trim()}`))));
    child.stdin.end(stdin ?? "");
  });
}

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes("--confirm");
  const replace = args.includes("--replace");
  const serviceAt = args.indexOf("--service");
  const service = serviceAt >= 0 ? args[serviceAt + 1]! : "keeper";
  // The arguments reach a shell on Windows, so only plain names pass.
  if (!/^[\w-]+$/.test(service)) throw new Error(`Not a service name: ${service}`);
  const roles = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--service");
  const unknown = roles.filter((r) => !isRoleName(r));
  if (roles.length === 0 || unknown.length > 0) throw new Error(`Name one or more roles: ${Object.keys(ROLES).join(", ")}${unknown.length ? ` (unknown: ${unknown.join(", ")})` : ""}`);
  const deploymentFile = process.env.DEPLOYMENT_FILE;
  if (!deploymentFile) throw new Error("DEPLOYMENT_FILE is not set");
  const deployment = readDeployment(deploymentFile);

  // Only the names are used; the values never leave this process.
  const existing = new Set(Object.keys(JSON.parse(await railway(["variable", "list", "--service", service, "--json"])) as Record<string, string>).filter((k) => isRoleName(k)));

  const lines: string[] = [];
  const handover: string[] = [];
  for (const role of roles as RoleName[]) {
    if (existing.has(role) && !replace) {
      lines.push(`${role}: already set on ${service}, kept (use --replace to rotate)`);
      continue;
    }
    const key = generatePrivateKey();
    const address = privateKeyToAddress(key);
    if (confirm) await railway(["variable", "set", role, "--stdin", "--service", service, "--skip-deploys"], key);
    lines.push(`${role} (${ROLES[role].label}): ${address}${confirm ? "" : "  [dry run, nothing stored]"}`);
    lines.push(`  grant: ${ROLES[role].grant(deployment, address)}`);
    handover.push(`${SET_ROLES_ENV[role]}=${address}`);
  }
  console.log(lines.join("\n"));
  if (handover.length > 0) console.log(`\nFor the owner (Wangsit): ${handover.join(" ")} make set-roles-monad CONFIRM=yes`);
  console.log(confirm ? `\nStored on ${service} without a deploy. Grant the roles on chain (owner or multisig), fund each address with MON, then redeploy ${service}.` : "\nDry run. Add --confirm to create and store the keys.");
}

await main();
