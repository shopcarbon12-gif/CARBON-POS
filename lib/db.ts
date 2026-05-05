import { Pool, type PoolClient, type PoolConfig } from "pg";

let pool: Pool | null = null;

const poolCommon: Pick<
  PoolConfig,
  "max" | "idleTimeoutMillis" | "connectionTimeoutMillis"
> = {
  max: Number(process.env.PG_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
};

function getConnectionString(): string | undefined {
  const url = process.env.DATABASE_URL?.trim();
  return url && url.length > 0 ? url : undefined;
}

/** Singleton pg Pool — same shared-DB pattern as CarbonWMS. */
export function getPool(): Pool {
  if (pool) return pool;
  const connectionString = getConnectionString();
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. POS cannot connect to the shared CarbonWMS database.",
    );
  }
  pool = new Pool({ connectionString, ...poolCommon });
  pool.on("error", (err) => {
    console.error("[db] idle pool client error", err);
  });
  return pool;
}

/** Default export so callers can `import pool from "@/lib/db"`. */
const proxy = new Proxy(
  {},
  {
    get(_t, prop: string) {
      const p = getPool() as unknown as Record<string, unknown>;
      const v = p[prop];
      return typeof v === "function" ? v.bind(p) : v;
    },
  },
) as Pool;

export default proxy;

/**
 * Run a function inside a transaction. Commits on success, rolls back on
 * any thrown error. The whole sale-finalization flow uses this so a
 * partial sale never lands in pos_sales while EPCs are already marked sold.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error("[db] rollback failed", rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }
}
