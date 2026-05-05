/**
 * Apply every .sql file in /migrations in numeric order.
 * Idempotent — each migration starts with BEGIN and uses CREATE TABLE IF
 * NOT EXISTS / CREATE INDEX IF NOT EXISTS so re-running is safe.
 *
 * Run:  npm run db:migrate
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  const dir = join(process.cwd(), "migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(dir, file), "utf8");
    process.stdout.write(`[migrate] ${file} ... `);
    try {
      await pool.query(sql);
      console.log("ok");
    } catch (err) {
      console.log("FAILED");
      console.error(err);
      await pool.end();
      process.exit(1);
    }
  }

  await pool.end();
  console.log("[migrate] done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
