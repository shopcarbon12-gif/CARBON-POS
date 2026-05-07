import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

const PAGE_SIZE = 25;

type SortKey =
  | "item_name"
  | "color"
  | "size"
  | "upc"
  | "sku"
  | "stock"
  | "price";

const SORT_SQL: Record<SortKey, string> = {
  item_name: "m.description",
  color: "cs.color_code",
  size: "cs.size",
  upc: "cs.upc",
  sku: "cs.sku",
  stock: "COALESCE(c.n, 0)",
  price: "cs.retail_price",
};

/**
 * GET /api/pos/inventory?q=...&sort=...&dir=...&page=...
 *
 * Drives the live search on the Inventory tab. The search is partial
 * (ILIKE %q%) across every catalog field a cashier might type — name,
 * SKU, UPC, color, size, brand, vendor, category. Results are scoped to
 * the active location's in-stock count.
 */
export async function GET(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const sortParam = url.searchParams.get("sort") ?? "item_name";
  const sort: SortKey =
    sortParam in SORT_SQL ? (sortParam as SortKey) : "item_name";
  const dir = url.searchParams.get("dir") === "desc" ? "desc" : "asc";
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const orderBy = `${SORT_SQL[sort]} ${dir.toUpperCase()} NULLS LAST, cs.sku ASC`;

  const rowsArgs: unknown[] = [cashier.lid];
  const countArgs: unknown[] = [];
  const rowsFilters: string[] = ["COALESCE(cs.archived, FALSE) = FALSE"];
  const countFilters: string[] = ["COALESCE(cs.archived, FALSE) = FALSE"];

  if (q.length > 0) {
    const like = `%${q}%`;
    rowsArgs.push(like);
    countArgs.push(like);
    // Mirror the broad partial-match behaviour of /api/pos/items/search:
    // every catalog field a cashier might pattern-match against.
    rowsFilters.push(
      `(m.description ILIKE $${rowsArgs.length}
        OR cs.sku        ILIKE $${rowsArgs.length}
        OR cs.upc        ILIKE $${rowsArgs.length}
        OR m.upc         ILIKE $${rowsArgs.length}
        OR cs.color_code ILIKE $${rowsArgs.length}
        OR cs.size       ILIKE $${rowsArgs.length}
        OR m.brand       ILIKE $${rowsArgs.length}
        OR m.vendor      ILIKE $${rowsArgs.length}
        OR m.category    ILIKE $${rowsArgs.length})`,
    );
    countFilters.push(
      `(m.description ILIKE $${countArgs.length}
        OR cs.sku        ILIKE $${countArgs.length}
        OR cs.upc        ILIKE $${countArgs.length}
        OR m.upc         ILIKE $${countArgs.length}
        OR cs.color_code ILIKE $${countArgs.length}
        OR cs.size       ILIKE $${countArgs.length}
        OR m.brand       ILIKE $${countArgs.length}
        OR m.vendor      ILIKE $${countArgs.length}
        OR m.category    ILIKE $${countArgs.length})`,
    );
  }

  rowsArgs.push(PAGE_SIZE, offset);
  const limitIdx = rowsArgs.length - 1;
  const offsetIdx = rowsArgs.length;

  const pool = getPool();
  const [rowsR, totalR] = await Promise.all([
    pool.query<{
      id: string;
      sku: string;
      upc: string | null;
      item_name: string;
      category: string | null;
      color: string | null;
      size: string | null;
      retail_price: string | null;
      stock_count: string;
    }>(
      `SELECT cs.id::text,
              cs.sku,
              cs.upc,
              m.description       AS item_name,
              m.category          AS category,
              cs.color_code       AS color,
              cs.size,
              cs.retail_price::text,
              COALESCE(c.n, 0)::text AS stock_count
         FROM custom_skus cs
         JOIN matrices m ON m.id = cs.matrix_id
         LEFT JOIN LATERAL (
           SELECT COUNT(*) AS n
             FROM items i
            WHERE i.custom_sku_id = cs.id
              AND i.location_id   = $1::uuid
              AND i.status        = 'in-stock'
         ) c ON TRUE
        WHERE TRUE
          AND ${rowsFilters.join(" AND ")}
        ORDER BY ${orderBy}
        LIMIT $${limitIdx}::int OFFSET $${offsetIdx}::int`,
      rowsArgs,
    ),
    pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n
         FROM custom_skus cs
         JOIN matrices m ON m.id = cs.matrix_id
        WHERE TRUE AND ${countFilters.join(" AND ")}`,
      countArgs,
    ),
  ]);

  return NextResponse.json({
    rows: rowsR.rows.map((r) => ({
      id: r.id,
      sku: r.sku,
      upc: r.upc,
      item_name: r.item_name,
      category: r.category,
      color: r.color,
      size: r.size,
      retail_price: r.retail_price,
      stock_count: Number(r.stock_count),
      // Catalog doesn't carry image_url today — Phase-2 hooks the WMS
      // media bucket. The popup falls back to "Picture not available".
      image_url: null,
    })),
    total: Number(totalR.rows[0]?.n ?? 0),
  });
}
