"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Edit link + Archive/Unarchive action for a row on the employees list.
 * Archiving sets pos_employees.is_active = false, which immediately blocks
 * POS sign-in (auth filters is_active = TRUE). It does not touch the user's
 * WMS access.
 */
export function EmployeeRowActions({
  code,
  id,
  isActive,
}: {
  code: string;
  id: number;
  isActive: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function setActive(active: boolean) {
    if (!active && !confirm("Archive this employee? They won't be able to sign in to POS until you unarchive them.")) {
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/pos/employees/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ is_active: active }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
    else alert("Couldn't update the employee. Try again.");
  }

  return (
    <div className="flex items-center gap-4">
      <Link
        href={`/employees/${code}/${id}`}
        className="text-[var(--color-pos-muted)] underline"
      >
        Edit
      </Link>
      {isActive ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => setActive(false)}
          className="text-[var(--color-pos-danger)] underline disabled:opacity-50"
        >
          Archive
        </button>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => setActive(true)}
          className="text-carbon-blue underline disabled:opacity-50"
        >
          Unarchive
        </button>
      )}
    </div>
  );
}
