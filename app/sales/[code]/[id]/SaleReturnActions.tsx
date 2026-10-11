"use client";

import Link from "next/link";
import { usePermissions } from "@/lib/use-permissions";

/**
 * Exchange / Refund shortcuts on the order screen. Both open the sell
 * screen with this receipt already loaded in the Return panel, so the
 * cashier just takes the pieces back (scanning each tag) as usual.
 */
export function SaleReturnActions({
  code,
  saleNumber,
  returnable,
}: {
  code: string;
  saleNumber: string;
  /** Anything left on the sale that can still come back. */
  returnable: boolean;
}) {
  const perms = usePermissions();
  const href = (mode: "exchange" | "refund") =>
    `/sales/${code}/new?returns=${mode}&receipt=${encodeURIComponent(saleNumber)}`;
  const btn =
    "tap flex-1 flex items-center justify-center gap-2 px-4 font-semibold border border-[var(--color-pos-border)] bg-white hover:bg-[var(--color-pos-bg)]";
  const off = "opacity-40 pointer-events-none";
  const canExchange = perms.allowed("pos_sales.exchange");
  const canRefund = perms.allowed("pos_sales.refund");
  if (!canExchange && !canRefund) return null;

  return (
    <div className="bg-white border border-[var(--color-pos-border)] p-4">
      <h2 className="font-semibold mb-3">Returns</h2>
      <div className="flex gap-2">
        {canExchange && (
          <Link href={href("exchange")} className={`${btn} ${returnable ? "" : off}`} aria-disabled={!returnable}>
            <span className="material-symbols-outlined text-[20px]" aria-hidden>swap_horiz</span>
            Exchange
          </Link>
        )}
        {canRefund && (
          <Link href={href("refund")} className={`${btn} ${returnable ? "" : off}`} aria-disabled={!returnable}>
            <span className="material-symbols-outlined text-[20px]" aria-hidden>undo</span>
            Refund
          </Link>
        )}
      </div>
      <p className="text-xs text-carbon-text-muted mt-2">
        {returnable
          ? "Opens the register with this receipt loaded — scan each item coming back."
          : "Everything on this sale has already been returned."}
      </p>
    </div>
  );
}
