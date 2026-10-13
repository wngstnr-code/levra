import { createDb } from "@levra/db";
import { loadOracleReport, renderOracleReport } from "./report";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const { db, close } = createDb(url, { max: 1 });
try {
  process.stdout.write(renderOracleReport(await loadOracleReport(db)));
} finally {
  await close();
}
