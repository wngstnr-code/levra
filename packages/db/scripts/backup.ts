import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTarget, requireDatabaseUrl, runPg, timestamp, type PgTarget } from "./pg-tools";

const defaultDir = fileURLToPath(new URL("../backups", import.meta.url));

export function backupPrefix(database: string): string {
  return `levra-${database}-`;
}

/** Writes a pg_dump custom-format file, which pg_restore can load into an empty database. */
export async function backup(target: PgTarget, dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${backupPrefix(target.database)}${timestamp()}.dump`);
  await runPg("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "-d", target.url], target, { stdoutFile: file });
  return file;
}

/** Deletes the oldest backups of this database so that `keep` remain. */
export async function prune(dir: string, database: string, keep: number): Promise<string[]> {
  const prefix = backupPrefix(database);
  const files = (await readdir(dir)).filter((name) => name.startsWith(prefix) && name.endsWith(".dump")).sort();
  const old = files.slice(0, Math.max(0, files.length - keep));
  for (const name of old) await rm(join(dir, name));
  return old;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = parseTarget(requireDatabaseUrl());
  const dir = resolve(process.env.BACKUP_DIR ?? defaultDir);
  const keep = Number(process.env.BACKUP_KEEP ?? "14");
  if (!Number.isInteger(keep) || keep < 1) throw new Error("BACKUP_KEEP must be a whole number of at least 1");

  const file = await backup(target, dir);
  const { size } = await stat(file);
  console.log(`backup of ${target.database}: ${file} (${size} bytes)`);
  for (const name of await prune(dir, target.database, keep)) console.log(`removed old backup ${name}`);
}
