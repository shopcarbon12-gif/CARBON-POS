/**
 * Container-boot migrations for Carbon POS.
 * Applies every .sql file in /app/migrations in numeric order. Each file is
 * recorded in the pos_schema_migrations table so non-idempotent statements
 * never re-run. Mirrors the WMS docker-migrate.mjs pattern.
 *
 * Run from docker-entrypoint when POS_AUTO_MIGRATE=1.
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const appRoot = process.cwd();
const pkgPath = join(appRoot, "package.json");
if (!existsSync(pkgPath)) {
  console.error("pos: docker-migrate: missing package.json at", pkgPath);
  process.exit(1);
}

let Pool;
try {
  const require = createRequire(pkgPath);
  ({ Pool } = require("pg"));
} catch (e) {
  console.error(
    "pos: docker-migrate: cannot load pg — ensure node-postgres is in /app/node_modules.",
    e?.message || e,
  );
  process.exit(1);
}

function getUrl() {
  const u = process.env.DATABASE_URL?.trim();
  if (!u) throw new Error("DATABASE_URL is required");
  return u;
}

function sha256Hex(s) {
  return createHash("sha256").update(s).digest("hex");
}

async function ensureTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pos_schema_migrations (
      filename    TEXT PRIMARY KEY,
      sha256      TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function alreadyApplied(pool, filename, hash) {
  const r = await pool.query(
    `SELECT sha256 FROM pos_schema_migrations WHERE filename = $1`,
    [filename],
  );
  if (r.rows.length === 0) return false;
  if (r.rows[0].sha256 !== hash) {
    console.warn(
      `pos: docker-migrate: ${filename} hash drift (db=${r.rows[0].sha256.slice(0, 8)} file=${hash.slice(0, 8)}) — skipping.`,
    );
  }
  return true;
}

async function recordApplied(pool, filename, hash) {
  await pool.query(
    `INSERT INTO pos_schema_migrations (filename, sha256)
     VALUES ($1, $2)
     ON CONFLICT (filename) DO NOTHING`,
    [filename, hash],
  );
}

async function main() {
  const pool = new Pool({ connectionString: getUrl() });
  try {
    await ensureTable(pool);
    const dir = join(appRoot, "migrations");
    if (!existsSync(dir)) {
      console.warn("pos: docker-migrate: /app/migrations missing — nothing to run.");
      return;
    }
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const sql = readFileSync(join(dir, file), "utf8");
      const hash = sha256Hex(sql);
      if (await alreadyApplied(pool, file, hash)) {
        console.log(`pos: docker-migrate: ${file} already applied`);
        continue;
      }
      console.log(`pos: docker-migrate: applying ${file}`);
      await pool.query(sql);
      await recordApplied(pool, file, hash);
    }
    console.log("pos: docker-migrate: done");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("pos: docker-migrate failed:", err);
  process.exit(1);
});
