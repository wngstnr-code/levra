import { spawn } from "node:child_process";

/**
 * Moves variables from a Railway service straight into secret files on the VPS (BE-91, docs/hosting.md). Each value
 * goes from the Railway CLI to `ssh` through pipes: it is never printed, written on this machine or put on a command
 * line. Only names are printed. An existing file on the server is kept.
 *
 *   tsx scripts/move-variables.ts --from keeper --to levra@<server> --service keeper-monad NAME [NAME ...] [--confirm]
 *
 * Needs a Railway CLI that is logged in and linked to the project (`railway login`, `railway link`), and SSH access to
 * the server as a user in the docker group. Without --confirm it only checks which names Railway has.
 */

const RAILWAY = process.env.RAILWAY_BIN ?? "railway";
const SSH = process.env.SSH_BIN ?? "ssh";
const VARIABLE = /^[A-Z_][A-Z0-9_]*$/;
const PLAIN = /^[\w@.-]+$/;

export type MoveArgs = { from: string; to: string; service: string; names: string[]; confirm: boolean };

export function parseMoveArgs(args: string[]): MoveArgs {
  const value = (flag: string) => {
    const at = args.indexOf(flag);
    const v = at >= 0 ? args[at + 1] : undefined;
    if (!v || v.startsWith("--")) throw new Error(`Missing ${flag}`);
    // These reach a shell (Windows for the Railway CLI, the server for ssh), so only plain names pass.
    if (!PLAIN.test(v)) throw new Error(`Not a plain name for ${flag}: ${v}`);
    return v;
  };
  const from = value("--from");
  const to = value("--to");
  const service = value("--service");
  const taken = new Set(["--from", "--to", "--service"].map((f) => args.indexOf(f) + 1));
  const names = args.filter((a, i) => !a.startsWith("--") && !taken.has(i));
  const bad = names.filter((n) => !VARIABLE.test(n));
  if (names.length === 0 || bad.length > 0) throw new Error(`Name the variables to move${bad.length ? ` (not variable names: ${bad.join(", ")})` : ""}`);
  return { from, to, service, names, confirm: args.includes("--confirm") };
}

/**
 * The command the server runs for one secret. A throwaway container writes the file as uid 1000 (the image's user),
 * mode 0400, and refuses to overwrite an existing file.
 */
export function remoteWrite(service: string, name: string): string {
  const dir = `/opt/levra/secrets/${service}`;
  const script = `umask 0377; set -C; cat > /out/${name}`;
  return `docker run --rm -i --network none --user 1000:1000 -v ${dir}:/out alpine:3.20 sh -c '${script}'`;
}

function run(file: string, args: string[], stdin = "", shell = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { shell, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", reject);
    // Only the first word goes in the error, never stdin.
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${file} ${args[0] ?? ""} failed: ${err.trim()}`))));
    child.stdin.end(stdin);
  });
}

/** All variables of a Railway service, held in memory only. `service` must be a plain name. */
export async function railwayVariables(service: string): Promise<Record<string, string>> {
  if (!PLAIN.test(service)) throw new Error(`Not a plain service name: ${service}`);
  // A shell finds the npm shim on Windows; nothing secret is on the command line.
  const out = await run(RAILWAY, ["variable", "list", "--service", service, "--json"], "", process.platform === "win32");
  try {
    // PowerShell's npm shim can put a byte order mark in front.
    return JSON.parse(out.replace(/^﻿/, "")) as Record<string, string>;
  } catch {
    // The output holds secret values, so none of it goes into the error.
    throw new Error(`Railway did not return JSON for service ${service}`);
  }
}

async function main() {
  const { from, to, service, names, confirm } = parseMoveArgs(process.argv.slice(2));
  const variables = await railwayVariables(from);
  for (const name of names) {
    const value = variables[name];
    if (!value) {
      console.log(`${name}: not set on Railway service ${from}, skipped`);
      continue;
    }
    if (!confirm) {
      console.log(`${name}: found on ${from}  [dry run, nothing moved]`);
      continue;
    }
    try {
      await run(SSH, [to, remoteWrite(service, name)], value);
      console.log(`${name}: moved to ${to}:/opt/levra/secrets/${service}/${name}`);
    } catch (error) {
      // The server's error names the file, never the value; an existing file is refused by `set -C`.
      console.log(`${name}: not moved (${(error as Error).message})`);
    }
  }
  if (!confirm) console.log("\nDry run. Add --confirm to move the values.");
}

if (process.argv[1]?.endsWith("move-variables.ts")) await main();
