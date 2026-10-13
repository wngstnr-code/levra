import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { backup } from "./backup";
import { parseTarget, psql, quoteIdent, requireDatabaseUrl, tableRowCounts, timestamp, withDatabase } from "./pg-tools";
import { restore } from "./restore";

export interface TableCheck {
  table: string;
  before: bigint | undefined;
  restored: bigint | undefined;
  after: bigint | undefined;
  ok: boolean;
}

/**
 * The source keeps changing while the dump runs (the indexer and keepers write all the time), so a
 * restored count is right when it lies between the count before the dump and the count after it.
 */
export function compareCounts(
  before: Map<string, bigint>,
  restored: Map<string, bigint>,
  after: Map<string, bigint>,
): TableCheck[] {
  const tables = [...new Set([...before.keys(), ...restored.keys(), ...after.keys()])].sort();
  return tables.map((table) => {
    const b = before.get(table);
    const r = restored.get(table);
    const a = after.get(table);
    const low = b !== undefined && a !== undefined ? (b < a ? b : a) : undefined;
    const high = b !== undefined && a !== undefined ? (b > a ? b : a) : undefined;
    const ok = r !== undefined && low !== undefined && high !== undefined && r >= low && r <= high;
    return { table, before: b, restored: r, after: a, ok };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const source = parseTarget(requireDatabaseUrl());
  const scratchName = `${source.database}_restore_check_${timestamp().toLowerCase()}`;
  const scratch = withDatabase(source, scratchName);
  const admin = withDatabase(source, process.env.PG_ADMIN_DATABASE ?? "postgres");
  const dir = await mkdtemp(join(tmpdir(), "levra-restore-check-"));

  let failed = false;
  try {
    const before = await tableRowCounts(source);
    const started = Date.now();
    const file = await backup(source, dir);
    const after = await tableRowCounts(source);

    await psql(admin, `create database ${quoteIdent(scratchName)}`);
    await restore(file, scratch, false);
    const restored = await tableRowCounts(scratch);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);

    const checks = compareCounts(before, restored, after);
    failed = checks.length === 0 || checks.some((check) => !check.ok);
    console.log(`restore check of ${source.database} into ${scratchName}, backup and restore in ${seconds} s`);
    console.table(
      checks.map((check) => ({
        table: check.table,
        before: check.before?.toString() ?? "missing",
        restored: check.restored?.toString() ?? "missing",
        after: check.after?.toString() ?? "missing",
        result: check.ok ? "ok" : "MISMATCH",
      })),
    );
    console.log(failed ? "restore check FAILED" : "restore check passed");
  } finally {
    await psql(admin, `drop database if exists ${quoteIdent(scratchName)}`);
    await rm(dir, { recursive: true, force: true });
  }
  if (failed) process.exitCode = 1;
}
