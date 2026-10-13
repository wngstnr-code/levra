import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prune } from "./backup";
import { parseTarget, withDatabase } from "./pg-tools";
import { compareCounts } from "./restore-check";

describe("parseTarget", () => {
  afterEach(() => {
    delete process.env.PG_DOCKER_SERVICE;
  });

  it("keeps the password out of the URL", () => {
    const target = parseTarget("postgres://levra:s%40cret@localhost:5442/levra_staging");
    expect(target.password).toBe("s@cret");
    expect(target.url).not.toContain("cret");
    expect(target.database).toBe("levra_staging");
  });

  it("points at the container port in docker mode", () => {
    process.env.PG_DOCKER_SERVICE = "postgres";
    const target = parseTarget("postgres://levra:levra@localhost:5442/levra");
    expect(new URL(target.url).host).toBe("127.0.0.1:5432");
  });

  it("switches the database name", () => {
    const target = withDatabase(parseTarget("postgres://levra:levra@localhost:5442/levra"), "postgres");
    expect(target.database).toBe("postgres");
    expect(new URL(target.url).pathname).toBe("/postgres");
  });

  it("rejects a URL without a database", () => {
    expect(() => parseTarget("postgres://levra@localhost:5442")).toThrow();
  });
});

describe("compareCounts", () => {
  const counts = (entries: [string, bigint][]) => new Map(entries);

  it("accepts a restored count between the counts before and after the dump", () => {
    const checks = compareCounts(
      counts([["public.router_events", 10n]]),
      counts([["public.router_events", 12n]]),
      counts([["public.router_events", 13n]]),
    );
    expect(checks).toEqual([{ table: "public.router_events", before: 10n, restored: 12n, after: 13n, ok: true }]);
  });

  it("flags a lost row and a missing table", () => {
    const checks = compareCounts(
      counts([
        ["public.morpho_events", 5n],
        ["public.oracle_updates", 7n],
      ]),
      counts([["public.morpho_events", 4n]]),
      counts([
        ["public.morpho_events", 5n],
        ["public.oracle_updates", 7n],
      ]),
    );
    expect(checks.map((check) => [check.table, check.ok])).toEqual([
      ["public.morpho_events", false],
      ["public.oracle_updates", false],
    ]);
  });
});

describe("prune", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("keeps the newest backups of one database and leaves other files alone", async () => {
    dir = await mkdtemp(join(tmpdir(), "levra-prune-"));
    const names = [
      "levra-levra-20261011T000000Z.dump",
      "levra-levra-20261012T000000Z.dump",
      "levra-levra-20261013T000000Z.dump",
      "levra-levra_staging-20261010T000000Z.dump",
      "notes.txt",
    ];
    for (const name of names) await writeFile(join(dir, name), "");

    const removed = await prune(dir, "levra", 2);

    expect(removed).toEqual(["levra-levra-20261011T000000Z.dump"]);
    expect((await readdir(dir)).sort()).toEqual(names.slice(1).sort());
  });
});
