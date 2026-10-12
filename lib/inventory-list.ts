import { getPool } from "@/lib/db";

export const INVENTORY_PAGE_SIZE = 25;

export type InventorySortKey = "item_name" | "color" | "size" | "upc" | "sku" | "stock" | "price";

const SORT_SQL: Record<InventorySortKey, string> = {
  item_name: "m.description",
  color: "cs.color_code",
  size: "cs.size",
  upc: "cs.upc",
  sku: "cs.sku",
  stock: "(COALESCE(c.n, 0) + COALESCE(mq.qty, 0))",
  price: "cs.retail_price",
};

export type InventoryRow = {
  id: string;
  sku: string;
  upc: string | null;
  item_name: string;
  category: string | null;
  color: string | null;
  size: string | null;
  retail_price: string | null;
  stock_count: number;
  is_manual_only: boolean;
  image_url: string | null;
};

export function parseInventorySort(s: string | null | undefined): InventorySortKey {
  return s && s in SORT_SQL ? (s as InventorySortKey) : "item_name";
}

/**
 * One page of the Products tab, read straight from the WMS catalog
 * (shared DB), so it's always what WMS has right now. Used by both the
 * server first paint and the live-refresh API so they can't drift.
 *
 * Stock = RFID tags in stock at this store + the manual (untagged) count.
 * Picture = the variant's own Shopify image, else the style's main one.
 */
export async function listInventory(a: {
  lid: string;
  q: string;
  sort: InventorySortKey;
  dir: "asc" | "desc";
  page: number;
}): Promise<{ rows: InventoryRow[]; total: number }> {
  const offset = (a.page - 1) * INVENTORY_PAGE_SIZE;
  const orderBy = `${SORT_SQL[a.sort]} ${a.dir.toUpperCase()} NULLS LAST, cs.sku ASC`;
  const filters = ["COALESCE(cs.archived, FALSE) = FALSE"];
  const args: unknown[] = [a.lid];
  if (a.q.length > 0) {
    args.push(`%${a.q}%`);
    const p = `$${args.length}`;
    filters.push(
      `(m.description ILIKE ${p} OR cs.sku ILIKE ${p} OR cs.upc ILIKE ${p}
        OR m.upc ILIKE ${p} OR cs.color_code ILIKE ${p} OR cs.size ILIKE ${p}
        OR m.brand ILIKE ${p} OR m.vendor ILIKE ${p} OR m.category ILIKE ${p})`,
    );
  }
  const where = filters.join(" AND ");
  const countArgs = args.slice(1);
  // Count query has no $1 lid → renumber its search param to $1.
  const countWhere = where.split("$2").join("$1");
  args.push(INVENTORY_PAGE_SIZE, offset);

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
      stock_count: number;
      is_manual_only: boolean;
      image_url: string | null;
    }>(
      `SELECT cs.id::text,
              cs.sku,
              COALESCE(cs.upc, m.upc)              AS upc,
              m.description                        AS item_name,
              m.category                           AS category,
              cs.color_code                        AS color,
              cs.size,
              cs.retail_price::text,
              (COALESCE(c.n, 0) + COALESCE(mq.qty, 0))::int AS stock_count,
              COALESCE(m.is_manual_only, FALSE)    AS is_manual_only,
              COALESCE(cs.shopify_image_url, m.shopify_featured_image_url) AS image_url
         FROM custom_skus cs
         JOIN matrices m ON m.id = cs.matrix_id
         LEFT JOIN LATERAL (
           SELECT COUNT(*) AS n
             FROM items i
            WHERE i.custom_sku_id = cs.id
              AND i.location_id   = $1::uuid
              AND i.status        = 'in-stock'
         ) c ON TRUE
         LEFT JOIN LATERAL (
           SELECT q.current_qty AS qty
             FROM manual_item_qty q
            WHERE q.custom_sku_id = cs.id AND q.location_id = $1::uuid
         ) mq ON TRUE
        WHERE ${where}
        ORDER BY ${orderBy}
        LIMIT $${args.length - 1}::int OFFSET $${args.length}::int`,
      args,
    ),
    pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n
         FROM custom_skus cs
         JOIN matrices m ON m.id = cs.matrix_id
        WHERE ${countWhere}`,
      countArgs,
    ),
  ]);
  return {
    rows: rowsR.rows.map((r) => ({
      ...r,
      stock_count: Number(r.stock_count),
      is_manual_only: r.is_manual_only === true,
      image_url: r.image_url ?? null,
    })),
    total: Number(totalR.rows[0]?.n ?? 0),
  };
}
