"use client";

import { useRouter } from "next/navigation";

/**
 * One clickable row in the customers list table. The whole row navigates to
 * the customer detail page (not just the name), with keyboard support so it
 * stays accessible. Server page pre-formats `created` to a date string so we
 * don't ship a Date across the RSC boundary.
 */
export type CustomerListItem = {
  id: number;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  phone_2: string | null;
  email: string | null;
  email_2: string | null;
  sales_count: number | string;
  points: number | string;
  created: string | null;
};

export function CustomerListRow({
  code,
  c,
}: {
  code: string;
  c: CustomerListItem;
}) {
  const router = useRouter();
  const href = `/customers/${code}/${c.id}`;
  const go = () => router.push(href);
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || "customer";

  return (
    <tr
      onClick={go}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          go();
        }
      }}
      tabIndex={0}
      role="link"
      aria-label={`Open ${name}`}
      className="border-t border-[var(--color-pos-border)] cursor-pointer hover:bg-[var(--color-pos-bg)] focus:bg-[var(--color-pos-bg)] focus:outline-none"
    >
      <td className="px-3 py-2">{c.first_name || "—"}</td>
      <td className="px-3 py-2">{c.last_name ?? "—"}</td>
      <td className="px-3 py-2 tabular-nums">{c.phone ?? "—"}</td>
      <td className="px-3 py-2 tabular-nums">{c.phone_2 ?? "—"}</td>
      <td className="px-3 py-2">{c.email ?? "—"}</td>
      <td className="px-3 py-2">{c.email_2 ?? "—"}</td>
      <td className="px-3 py-2 text-right tabular-nums">{c.sales_count}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {Number(c.points).toLocaleString()}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-[var(--color-pos-muted)]">
        {c.created ?? "—"}
      </td>
    </tr>
  );
}
