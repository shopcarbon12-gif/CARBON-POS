"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatMoney } from "@/lib/utils";

type StockCard = {
  sku_id: string | null;
  product: {
    sku: string;
    upc: string | null;
    item_name: string;
    brand: string | null;
    vendor: string | null;
    category: string | null;
    color: string | null;
    size: string | null;
    retail_price: string | null;
    image_url: string | null;
    is_manual_only: boolean;
  } | null;
  in_stock: number;
  in_transit: number;
  elsewhere: number;
  by_location: Array<{ location_name: string; n: number; is_here: boolean }>;
  variants: Array<{
    id: string;
    sku: string;
    color: string | null;
    size: string | null;
    retail_price: string | null;
    here: number;
    elsewhere: number;
  }>;
  tag: {
    epc: string;
    status: string;
    location_name: string | null;
    is_here: boolean;
    bin: string | null;
    last_seen_at: string | null;
    history: Array<{ at: string; event: string; detail: string | null; sale_id?: number; refund_id?: number }>;
  } | null;
  can_manage: boolean;
};

const STATUS_STYLE: Record<string, string> = {
  "in-stock": "bg-green-50 text-green-800",
  sold: "bg-zinc-100 text-zinc-700",
  damaged: "bg-red-50 text-red-800",
  tag_killed: "bg-red-50 text-red-800",
};
const STATUS_LABEL: Record<string, string> = {
  "in-stock": "In stock",
  sold: "Sold",
  damaged: "Damaged",
  tag_killed: "Tag dead",
  pending_visibility: "Pending",
  unknown: "Unknown",
};

/**
 * Item popup on the order screen: product, stock here / in transit / other
 * stores, every size & color of the style, and for RFID pieces the exact
 * tag — where it is now, its history, and (managers) mark damaged / back
 * in stock.
 */
export function ItemStockModal({
  code,
  skuId,
  epc,
  description,
  onClose,
}: {
  code: string;
  skuId: string | null;
  epc: string | null;
  description: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<StockCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (skuId) qs.set("sku", skuId);
    if (epc) qs.set("epc", epc);
    const r = await fetch(`/api/pos/items/stock-card?${qs}`).catch(() => null);
    if (!r?.ok) {
      setError("Couldn't load this item's stock.");
      return;
    }
    setData((await r.json()) as StockCard);
  }, [skuId, epc]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setTagStatus(status: "damaged" | "in-stock") {
    if (!data?.tag) return;
    const reason =
      status === "damaged"
        ? window.prompt("What's wrong with it? (optional)", "") ?? null
        : "";
    if (reason === null) return;
    setBusy(true);
    setMsg(null);
    const r = await fetch("/api/pos/items/tag-status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ epc: data.tag.epc, status, reason }),
    }).catch(() => null);
    setBusy(false);
    const d = (await r?.json().catch(() => ({}))) as { message?: string } | undefined;
    if (!r?.ok) {
      setMsg(d?.message ?? "Couldn't change the status.");
      return;
    }
    setMsg(status === "damaged" ? "Marked damaged — it's out of sellable stock." : "Back in stock.");
    void load();
  }

  const p = data?.product;
  const fmtAt = (iso: string) => new Date(iso).toLocaleString();

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-3xl p-5 sm:p-6 shadow-lg border border-carbon-border-soft max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex gap-4 min-w-0">
            {p?.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.image_url} alt="" className="w-20 h-20 object-cover border border-carbon-border-soft shrink-0" />
            ) : (
              <div className="w-20 h-20 bg-[var(--color-pos-bg)] flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-carbon-text-muted">checkroom</span>
              </div>
            )}
            <div className="min-w-0">
              <h2 className="text-xl font-bold leading-tight">{p?.item_name ?? description}</h2>
              {p && (
                <p className="text-sm text-carbon-text-muted mt-1">
                  {[p.sku, p.color, p.size, p.retail_price ? formatMoney(Number(p.retail_price)) : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
              {p && (p.brand || p.vendor || p.category || p.upc) && (
                <p className="text-xs text-carbon-text-muted mt-0.5">
                  {[p.brand, p.vendor, p.category, p.upc ? `UPC ${p.upc}` : null].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-2xl leading-none px-2 text-carbon-text-muted" aria-label="Close">
            ×
          </button>
        </div>

        {error && <p className="text-sm text-red-700 mt-4">{error}</p>}
        {!data && !error && <p className="text-sm text-carbon-text-muted mt-6">Loading stock…</p>}

        {data && (
          <>
            {data.sku_id && (
              <div className="grid grid-cols-3 gap-3 mt-5">
                <Tile label="In stock here" n={data.in_stock} strong />
                <Tile label="In transit" n={data.in_transit} />
                <Tile label="Other stores" n={data.elsewhere} />
              </div>
            )}

            {data.tag && (
              <section className="mt-5 border border-carbon-border-soft p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">This piece</h3>
                  <span className={`px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[data.tag.status] ?? "bg-zinc-100 text-zinc-700"}`}>
                    {STATUS_LABEL[data.tag.status] ?? data.tag.status}
                  </span>
                </div>
                <p className="text-xs font-mono text-carbon-text-muted mt-1 break-all">EPC {data.tag.epc}</p>
                <dl className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3 text-sm">
                  <Field k="Location" v={data.tag.location_name ?? "—"} />
                  <Field k="Bin" v={data.tag.bin ?? "—"} />
                  <Field k="Last seen" v={data.tag.last_seen_at ? fmtAt(data.tag.last_seen_at) : "—"} />
                </dl>
                {data.can_manage && data.tag.is_here && (data.tag.status === "in-stock" || data.tag.status === "damaged") && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {data.tag.status === "in-stock" ? (
                      <button
                        onClick={() => void setTagStatus("damaged")}
                        disabled={busy}
                        className="tap px-4 font-semibold border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        Mark damaged
                      </button>
                    ) : (
                      <button
                        onClick={() => void setTagStatus("in-stock")}
                        disabled={busy}
                        className="tap px-4 font-semibold border border-green-300 text-green-800 hover:bg-green-50 disabled:opacity-50"
                      >
                        Put back in stock
                      </button>
                    )}
                  </div>
                )}
                {msg && <p className="text-sm mt-2 text-carbon-text-muted">{msg}</p>}
                {data.tag.history.length > 0 && (
                  <>
                    <h4 className="text-xs uppercase tracking-wider font-bold text-carbon-text-muted mt-4 mb-1">History</h4>
                    <ul className="text-sm divide-y divide-[var(--color-pos-border)]">
                      {data.tag.history.map((h, i) => (
                        <li key={i} className="py-1.5 flex justify-between gap-3">
                          <span>
                            <span className="font-semibold">{h.event}</span>
                            {h.detail && (
                              <span className="text-carbon-text-muted">
                                {" · "}
                                {h.sale_id ? (
                                  <Link className="underline" href={`/sales/${code}/${h.sale_id}`}>{h.detail}</Link>
                                ) : h.refund_id ? (
                                  <Link className="underline" href={`/sales/${code}/refund/receipt?refund=${h.refund_id}`}>{h.detail}</Link>
                                ) : (
                                  h.detail
                                )}
                              </span>
                            )}
                          </span>
                          <span className="text-xs text-carbon-text-muted whitespace-nowrap">{fmtAt(h.at)}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            )}

            {data.variants.length > 1 && (
              <section className="mt-5">
                <h3 className="font-semibold mb-2">All sizes &amp; colors</h3>
                <div className="overflow-auto border border-carbon-border-soft">
                  <table className="w-full text-sm">
                    <thead className="bg-[var(--color-pos-bg)]">
                      <tr className="text-left">
                        <th className="px-3 py-2">Color</th>
                        <th className="px-3 py-2">Size</th>
                        <th className="px-3 py-2 text-right">Price</th>
                        <th className="px-3 py-2 text-right">Here</th>
                        <th className="px-3 py-2 text-right">Other stores</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.variants.map((v) => (
                        <tr
                          key={v.id}
                          className={`border-t border-[var(--color-pos-border)] ${v.id === data.sku_id ? "bg-blue-50 font-semibold" : ""}`}
                        >
                          <td className="px-3 py-1.5">{v.color ?? "—"}</td>
                          <td className="px-3 py-1.5">{v.size ?? "—"}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            {v.retail_price ? formatMoney(Number(v.retail_price)) : "—"}
                          </td>
                          <td className={`px-3 py-1.5 text-right tabular-nums ${v.here === 0 ? "text-red-700" : ""}`}>{v.here}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{v.elsewhere}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {data.by_location.length > 0 && (
              <section className="mt-5">
                <h3 className="font-semibold mb-2">Stock by store</h3>
                <ul className="text-sm border border-carbon-border-soft divide-y divide-[var(--color-pos-border)]">
                  {data.by_location.map((l) => (
                    <li key={l.location_name} className="px-3 py-1.5 flex justify-between">
                      <span>
                        {l.location_name}
                        {l.is_here && <span className="text-xs text-carbon-text-muted ml-2">(this store)</span>}
                      </span>
                      <span className="tabular-nums font-medium">{l.n}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {!data.sku_id && !data.tag && (
              <p className="text-sm text-carbon-text-muted mt-5">
                This line isn&apos;t linked to a catalog item (custom / misc line), so there&apos;s no stock to show.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Tile({ label, n, strong }: { label: string; n: number; strong?: boolean }) {
  return (
    <div className={`border p-3 text-center ${strong ? "border-carbon-blue" : "border-carbon-border-soft"}`}>
      <p className={`text-2xl font-bold tabular-nums ${n === 0 && strong ? "text-red-700" : ""}`}>{n}</p>
      <p className="text-xs text-carbon-text-muted">{label}</p>
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-carbon-text-muted">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}
