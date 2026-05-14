import { getPool } from "@/lib/db";
import { pageGuard } from "@/lib/page-guard";
import { AdminShell } from "@/components/admin/AdminShell";
import { InventoryTable, type Row } from "@/components/inventory/InventoryTable";

const PAGE_SIZE = 25;

type Search = {
  q?: string;
  sort?: string;
  dir?: string;
  page?: string;
};

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
 * Inventory tab — catalog browser scoped to the active location's stock.
 *
 * Search is partial across every catalog field, results render live
 * directly in the table (no dropdown). Image cell is clickable — opens
 * a popup with the product photo or a "Picture not available" placeholder.
 *
 * The server does the first paint so the page is meaningful without JS;
 * the InventoryTable client takes over once the user types or pages.
 */
export default async function InventoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Search>;
}) {
  const { code } = await params;
  const sp = await searchParams;
  const cashier = await pageGuard(code, {
    tab: "inventory",
    from: `/inventory/${code}`,
  });

  const q = (sp.q ?? "").trim();
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const sort = (sp.sort && sp.sort in SORT_SQL ? sp.sort : "item_name") as SortKey;
  const dir = sp.dir === "desc" ? "desc" : "asc";
  const orderBy = `${SORT_SQL[sort]} ${dir.toUpperCase()} NULLS LAST, cs.sku ASC`;

  const rowsArgs: unknown[] = [cashier.lid];
  const countArgs: unknown[] = [];
  const rowsFilters: string[] = ["COALESCE(cs.archived, FALSE) = FALSE"];
  const countFilters: string[] = ["COALESCE(cs.archived, FALSE) = FALSE"];

  if (q.length > 0) {
    const like = `%${q}%`;
    rowsArgs.push(like);
    countArgs.push(like);
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

  const offset = (page - 1) * PAGE_SIZE;
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
      is_manual_only: boolean;
    }>(
      `SELECT cs.id::text,
              cs.sku,
              cs.upc,
              m.description                       AS item_name,
              m.category                          AS category,
              cs.color_code                       AS color,
              cs.size,
              cs.retail_price::text,
              COALESCE(c.n, 0)::text              AS stock_count,
              COALESCE(m.is_manual_only, FALSE)   AS is_manual_only
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

  const initialRows: Row[] = rowsR.rows.map((r) => ({
    id: r.id,
    sku: r.sku,
    upc: r.upc,
    item_name: r.item_name,
    category: r.category,
    color: r.color,
    size: r.size,
    retail_price: r.retail_price,
    stock_count: Number(r.stock_count),
    is_manual_only: r.is_manual_only === true,
    image_url: null,
  }));

  return (
    <AdminShell
      email={cashier.email}
      active="inventory"
      code={code}
      title="Inventory"
    >
      <main className="p-6 lg:p-10">
        <div className="max-w-[1440px] mx-auto">
          <InventoryTable
            code={code}
            initialRows={initialRows}
            initialQ={q}
            initialSort={sort}
            initialDir={dir}
            initialPage={page}
            pageSize={PAGE_SIZE}
            initialTotal={Number(totalR.rows[0]?.n ?? 0)}
          />
        </div>
      </main>
    </AdminShell>
  );
}
