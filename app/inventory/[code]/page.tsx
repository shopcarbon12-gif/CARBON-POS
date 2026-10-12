import { pageGuard } from "@/lib/page-guard";
import { AdminShell } from "@/components/admin/AdminShell";
import { InventoryTable } from "@/components/inventory/InventoryTable";
import { INVENTORY_PAGE_SIZE, listInventory, parseInventorySort } from "@/lib/inventory-list";

export const dynamic = "force-dynamic";

type Search = {
  q?: string;
  sort?: string;
  dir?: string;
  page?: string;
};

/**
 * Products tab — the WMS catalog scoped to this store's stock, read from
 * the shared DB (lib/inventory-list). The server does the first paint;
 * InventoryTable then handles search / paging and refreshes itself every
 * few seconds so changes made in WMS (new items, prices, pictures, stock)
 * show up without reloading.
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
  const sort = parseInventorySort(sp.sort);
  const dir = sp.dir === "desc" ? "desc" : "asc";
  const { rows, total } = await listInventory({ lid: cashier.lid, q, sort, dir, page });

  return (
    <AdminShell email={cashier.email} active="inventory" code={code} title="Inventory">
      <main className="p-3 sm:p-6 lg:p-10">
        <div className="max-w-[1440px] mx-auto">
          <InventoryTable
            code={code}
            initialRows={rows}
            initialQ={q}
            initialSort={sort}
            initialDir={dir}
            initialPage={page}
            pageSize={INVENTORY_PAGE_SIZE}
            initialTotal={total}
          />
        </div>
      </main>
    </AdminShell>
  );
}
