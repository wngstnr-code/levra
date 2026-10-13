import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

/**
 * Runs pg_dump, pg_restore and psql either from PATH (or PG_BIN) or, when PG_DOCKER_SERVICE is set,
 * inside that docker compose service. Data always moves through stdin and stdout, so the dump file
 * stays on the host in both modes. The password goes through PGPASSWORD, never on the command line.
 */
export type PgTool = "pg_dump" | "pg_restore" | "psql";

export interface PgTarget {
  /** Connection URL without the password, safe to log. */
  url: string;
  database: string;
  password: string | undefined;
}

export function parseTarget(rawUrl: string): PgTarget {
  const url = new URL(rawUrl);
  const password = url.password ? decodeURIComponent(url.password) : undefined;
  url.password = "";
  if (process.env.PG_DOCKER_SERVICE) {
    url.hostname = "127.0.0.1";
    url.port = "5432";
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database) throw new Error("the database URL has no database name");
  return { url: url.toString(), database, password };
}

export function withDatabase(target: PgTarget, database: string): PgTarget {
  const url = new URL(target.url);
  url.pathname = `/${encodeURIComponent(database)}`;
  return { ...target, url: url.toString(), database };
}

export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}

function command(tool: PgTool, args: string[], target: PgTarget): { file: string; args: string[] } {
  const service = process.env.PG_DOCKER_SERVICE;
  if (service) {
    const env = target.password ? ["-e", "PGPASSWORD"] : [];
    return { file: "docker", args: ["compose", "exec", "-T", ...env, service, tool, ...args] };
  }
  const bin = process.env.PG_BIN;
  return { file: bin ? `${bin.replace(/[\\/]$/, "")}/${tool}` : tool, args };
}

interface RunOptions {
  stdinFile?: string;
  stdoutFile?: string;
}

export async function runPg(tool: PgTool, args: string[], target: PgTarget, options: RunOptions = {}): Promise<string> {
  const { file, args: fullArgs } = command(tool, args, target);
  const env = { ...process.env };
  if (target.password) env.PGPASSWORD = target.password;
  const child = spawn(file, fullArgs, { env, stdio: ["pipe", "pipe", "pipe"] });

  const stderr: Buffer[] = [];
  const stdout: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

  const exited = new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });

  const input = options.stdinFile ? pipeline(createReadStream(options.stdinFile), child.stdin) : (child.stdin.end(), Promise.resolve());
  const output = options.stdoutFile
    ? pipeline(child.stdout, createWriteStream(options.stdoutFile))
    : new Promise<void>((resolve) => {
        child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
        child.stdout.on("end", resolve);
      });

  const [code] = await Promise.all([exited, input, output]);
  if (code !== 0) {
    throw new Error(`${tool} exited with code ${code}: ${Buffer.concat(stderr).toString().trim()}`);
  }
  return Buffer.concat(stdout).toString();
}

export async function psql(target: PgTarget, query: string): Promise<string> {
  return runPg("psql", ["--no-psqlrc", "-v", "ON_ERROR_STOP=1", "-At", "-d", target.url, "-c", query], target);
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Exact row count of every table outside the system schemas, keyed by "schema.table". */
export async function tableRowCounts(target: PgTarget): Promise<Map<string, bigint>> {
  const rows = await psql(
    target,
    `select table_schema || '.' || table_name,
            (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
       from information_schema.tables
      where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog', 'information_schema')
      order by 1`,
  );
  const counts = new Map<string, bigint>();
  for (const line of rows.split(/\r?\n/)) {
    if (!line) continue;
    const [name, count] = line.split("|");
    if (name && count !== undefined) counts.set(name, BigInt(count));
  }
  return counts;
}

export function timestamp(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
}
