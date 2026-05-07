import Link from "next/link";
import { getPool } from "@/lib/db";
import { pageGuard } from "@/lib/page-guard";
import { formatMoney } from "@/lib/utils";
import { AdminShell } from "@/components/admin/AdminShell";

const PAGE_SIZE = 25;
const LOW_STOCK_THRESHOLD = 5;

type Search = {
  q?: string;
  size?: string;
  category?: string;
  page?: string;
};

/**
 * Inventory tab — catalog browser scoped to the active location's stock.
 * Layout follows the stitch_luxe_cloud_pos / product_management reference:
 *
 *   [Image][Product details][SKU][Stock pill][Price][Actions]
 *
 * Stock counts come from `items` rows where status='in-stock' AND
 * location_id = session.lid. The image column is a placeholder hexagon
 * (the catalog doesn't carry image_url today — Phase-2 hooks the WMS
 * media bucket).
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
  const size = (sp.size ?? "").trim();
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const args: unknown[] = [cashier.lid];
  const filters: string[] = ["COALESCE(cs.archived, FALSE) = FALSE"];
  if (q.length > 0) {
    args.push(`%${q}%`);
    const i = args.length;
    filters.push(
      `(m.description ILIKE $${i} OR cs.sku ILIKE $${i} OR cs.upc ILIKE $${i})`,
    );
  }
  if (size.length > 0) {
    args.push(size);
    filters.push(`cs.size = $${args.length}`);
  }
  const whereExtra = `AND ${filters.join(" AND ")}`;

  const pool = getPool();

  // Catalog rows + per-location in-stock counts. The LATERAL count keeps
  // the join from blowing up on locations with hundreds of EPCs per SKU.
  // The product name lives in `matrices.description` (custom_skus only
  // carries the variant attributes — sku, color_code, size, etc.).
  const offset = (page - 1) * PAGE_SIZE;
  args.push(PAGE_SIZE, offset);
  const limitIdx = args.length - 1;
  const offsetIdx = args.length;

  const [rowsR, totalR, sizesR] = await Promise.all([
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
          ${whereExtra}
        ORDER BY m.description ASC, cs.sku ASC
        LIMIT $${limitIdx}::int OFFSET $${offsetIdx}::int`,
      args,
    ),
    pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n
         FROM custom_skus cs
         JOIN matrices m ON m.id = cs.matrix_id
        WHERE TRUE ${whereExtra}`,
      args.slice(0, args.length - 2),
    ),
    pool.query<{ size: string }>(
      `SELECT DISTINCT size FROM custom_skus
        WHERE size IS NOT NULL AND size <> ''
        ORDER BY size ASC
        LIMIT 50`,
    ),
  ]);

  const total = Number(totalR.rows[0]?.n ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showFrom = total === 0 ? 0 : offset + 1;
  const showTo = Math.min(offset + rowsR.rows.length, total);

  return (
    <AdminShell
      email={cashier.email}
      active="inventory"
      code={code}
      title="Inventory"
    >
      <main className="p-6 lg:p-10">
        <div className="max-w-[1440px] mx-auto">
          {/* Page header */}
          <div className="flex flex-wrap justify-between items-end gap-3 mb-6">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">
                Product Management
              </h2>
              <p className="text-sm text-carbon-text-muted mt-1">
                Live catalog view scoped to this location. Stock counts come
                from RFID-tagged inventory in WMS.
              </p>
            </div>

            {/* Filters + Add */}
            <form className="flex flex-wrap items-end gap-3">
              <input
                type="text"
                name="q"
                defaultValue={q}
                placeholder="Search SKU, UPC, or name"
                className="carbon-input tap w-64"
              />
              <select
                name="size"
                defaultValue={size}
                className="carbon-input tap"
              >
                <option value="">Size: All</option>
                {sizesR.rows.map((r) => (
                  <option key={r.size} value={r.size}>
                    {r.size}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="carbon-btn-secondary tap px-4 font-semibold"
              >
                Filter
              </button>
              {/* Add Product hooks the WMS catalog import in Phase 2. For
                  now the button is parked behind a tooltip so the layout
                  matches the reference. */}
              <span
                title="Catalog is sourced from CarbonWMS — add SKUs there."
                className="carbon-btn-primary tap px-4 font-semibold flex items-center gap-2 cursor-not-allowed opacity-90"
                aria-disabled
              >
                <span className="material-symbols-outlined text-base">add</span>
                <span>Add Product</span>
              </span>
            </form>
          </div>

          {/* Table */}
          <div className="carbon-card overflow-hidden">
            <div className="grid grid-cols-[80px_2fr_1.2fr_1fr_1fr_100px] gap-4 px-4 py-3 border-b border-carbon-border-soft bg-[var(--carbon-surface-soft)]">
              <div className="text-[11px] uppercase tracking-wider font-bold text-carbon-text-muted">Image</div>
              <div className="text-[11px] uppercase tracking-wider font-bold text-carbon-text-muted">Product Details</div>
              <div className="text-[11px] uppercase tracking-wider font-bold text-carbon-text-muted">SKU</div>
              <div className="text-[11px] uppercase tracking-wider font-bold text-carbon-text-muted">Stock Level</div>
              <div className="text-[11px] uppercase tracking-wider font-bold text-carbon-text-muted text-right">Price</div>
              <div className="text-[11px] uppercase tracking-wider font-bold text-carbon-text-muted text-center">Actions</div>
            </div>
            <div className="divide-y divide-carbon-border-soft">
              {rowsR.rows.length === 0 ? (
                <p className="px-4 py-12 text-center text-carbon-text-muted">
                  No products match your filters.
                </p>
              ) : (
                rowsR.rows.map((row) => {
                  const stock = Number(row.stock_count);
                  const stockBadge =
                    stock === 0
                      ? {
                          label: "Out of stock",
                          cls: "bg-red-50 text-red-800 ring-1 ring-red-600/30",
                        }
                      : stock <= LOW_STOCK_THRESHOLD
                        ? {
                            label: `Low stock (${stock})`,
                            cls: "bg-amber-50 text-amber-900 ring-1 ring-amber-700/30",
                          }
                        : {
                            label: `In stock (${stock})`,
                            cls: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-700/30",
                          };
                  return (
                    <div
                      key={row.id}
                      className={`grid grid-cols-[80px_2fr_1.2fr_1fr_1fr_100px] gap-4 px-4 py-4 items-center hover:bg-[var(--carbon-surface-soft)] transition-colors ${
                        stock === 0 ? "opacity-75" : ""
                      }`}
                    >
                      <div className="w-12 h-12 bg-[var(--carbon-surface-soft)] border border-carbon-border-soft flex items-center justify-center">
                        <span className="material-symbols-outlined text-carbon-text-muted text-lg">
                          checkroom
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold truncate">
                          {row.item_name}
                        </p>
                        <p className="text-xs text-carbon-text-muted truncate">
                          {[row.color, row.size]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                          {row.upc ? ` · UPC ${row.upc}` : ""}
                        </p>
                      </div>
                      <div className="font-mono text-xs text-carbon-text-muted truncate">
                        {row.sku}
                      </div>
                      <div>
                        <span
                          className={`inline-flex items-center px-2 py-1 text-[10px] uppercase tracking-wider font-bold ${stockBadge.cls}`}
                        >
                          {stockBadge.label}
                        </span>
                      </div>
                      <div className="font-mono text-sm text-right tabular-nums">
                        {row.retail_price
                          ? formatMoney(row.retail_price)
                          : "—"}
                      </div>
                      <div className="flex justify-center gap-2">
                        <Link
                          href={`/sales/${code}/lookup?q=${encodeURIComponent(row.sku)}`}
                          className="text-carbon-text-muted hover:text-carbon-blue transition-colors"
                          title="Lookup details"
                        >
                          <span className="material-symbols-outlined text-[20px]">
                            visibility
                          </span>
                        </Link>
                        <Link
                          href={`/sales/${code}/new?seed=${encodeURIComponent(row.sku)}`}
                          className="text-carbon-text-muted hover:text-carbon-blue transition-colors"
                          title="Add to a new sale"
                        >
                          <span className="material-symbols-outlined text-[20px]">
                            add_shopping_cart
                          </span>
                        </Link>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div className="p-4 border-t border-carbon-border-soft flex items-center justify-between flex-wrap gap-3">
              <p className="text-xs text-carbon-text-muted">
                Showing {showFrom}–{showTo} of {total.toLocaleString()} products
              </p>
              <Pager
                code={code}
                page={page}
                totalPages={totalPages}
                q={q}
                size={size}
              />
            </div>
          </div>
        </div>
      </main>
    </AdminShell>
  );
}

function Pager({
  code,
  page,
  totalPages,
  q,
  size,
}: {
  code: string;
  page: number;
  totalPages: number;
  q: string;
  size: string;
}) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (size) params.set("size", size);
  const link = (p: number) => {
    const next = new URLSearchParams(params);
    next.set("page", String(p));
    return `/inventory/${code}?${next.toString()}`;
  };
  const prev = Math.max(1, page - 1);
  const next = Math.min(totalPages, page + 1);
  // Show a windowed page range (current ± 2).
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, start + 4);
  const pages: number[] = [];
  for (let p = start; p <= end; p++) pages.push(p);
  return (
    <div className="flex items-center gap-2">
      <Link
        href={link(prev)}
        aria-disabled={page === 1}
        className={`px-3 py-1 border border-carbon-border-soft text-[11px] uppercase tracking-wider font-bold ${
          page === 1
            ? "text-carbon-text-muted/50 pointer-events-none"
            : "text-carbon-text-muted hover:bg-[var(--carbon-surface-soft)]"
        }`}
      >
        Prev
      </Link>
      {pages.map((p) => (
        <Link
          key={p}
          href={link(p)}
          className={`px-3 py-1 border text-[11px] uppercase tracking-wider font-bold ${
            p === page
              ? "border-carbon-blue bg-[var(--carbon-blue-soft)] text-carbon-blue"
              : "border-carbon-border-soft text-carbon-text-muted hover:bg-[var(--carbon-surface-soft)]"
          }`}
        >
          {p}
        </Link>
      ))}
      <Link
        href={link(next)}
        aria-disabled={page === totalPages}
        className={`px-3 py-1 border border-carbon-border-soft text-[11px] uppercase tracking-wider font-bold ${
          page === totalPages
            ? "text-carbon-text-muted/50 pointer-events-none"
            : "text-carbon-text-muted hover:bg-[var(--carbon-surface-soft)]"
        }`}
      >
        Next
      </Link>
    </div>
  );
}
