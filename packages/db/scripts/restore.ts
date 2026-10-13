import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTarget, psql, requireDatabaseUrl, runPg, type PgTarget } from "./pg-tools";

export async function tableCount(target: PgTarget): Promise<number> {
  const out = await psql(
    target,
    "select count(*) from information_schema.tables where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog', 'information_schema')",
  );
  return Number(out.trim());
}

/**
 * Loads a backup into the database of `target` in one transaction, so a failed restore leaves
 * nothing behind. Refuses a database that already has tables unless `replace` is set.
 */
export async function restore(file: string, target: PgTarget, replace: boolean): Promise<void> {
  await access(file);
  const existing = await tableCount(target);
  if (existing > 0 && !replace) {
    throw new Error(`${target.database} already has ${existing} tables; pass --replace to drop and replace them`);
  }
  const args = ["--no-owner", "--no-privileges", "--exit-on-error", "--single-transaction", "-d", target.url];
  if (replace) args.unshift("--clean", "--if-exists");
  await runPg("pg_restore", args, target, { stdinFile: file });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const replace = args.includes("--replace");
  const file = args.find((arg) => !arg.startsWith("--"));
  if (!file) throw new Error("usage: restore.ts <backup file> [--replace]");

  const target = parseTarget(requireDatabaseUrl());
  await restore(resolve(file), target, replace);
  console.log(`restored ${file} into ${target.database}`);
}
