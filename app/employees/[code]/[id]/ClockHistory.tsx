"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Shift = { id: number; clock_in: string; clock_out: string | null };

/** Store-local "YYYY-MM-DDTHH:MM" for a datetime-local input. */
function toLocalInput(iso: string, tz: string): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}`;
}

/**
 * Manager view of an employee's shifts with fixes for the usual problems:
 * forgotten clock-out ("Clock out now"), wrong times (Edit, in store
 * time), and mistaken entries (Delete).
 */
export function ClockHistory({ shifts, tz }: { shifts: Shift[]; tz: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<number | null>(null);
  const [inVal, setInVal] = useState("");
  const [outVal, setOutVal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("en-US", {
      timeZone: tz,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

  async function patch(id: number, body: Record<string, unknown>) {
    setError(null);
    const r = await fetch(`/api/pos/clock/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const d = (await r.json().catch(() => ({}))) as { message?: string };
      setError(d.message ?? "Couldn't save the shift.");
      return;
    }
    setEditing(null);
    router.refresh();
  }

  async function remove(id: number) {
    if (!confirm("Delete this shift?")) return;
    await fetch(`/api/pos/clock/${id}`, { method: "DELETE" });
    router.refresh();
  }

  if (shifts.length === 0) {
    return <p className="text-sm text-[var(--color-pos-muted)]">No clock-in entries yet.</p>;
  }

  return (
    <>
      {error && <p className="text-sm text-[var(--color-pos-danger)] mb-2">{error}</p>}
      <ul className="text-sm divide-y divide-[var(--color-pos-border)]">
        {shifts.map((c) => {
          const minutes = Math.round(
            ((c.clock_out ? new Date(c.clock_out).getTime() : Date.now()) -
              new Date(c.clock_in).getTime()) /
              60000,
          );
          if (editing === c.id) {
            return (
              <li key={c.id} className="py-2 space-y-2">
                <label className="block text-xs">
                  In
                  <input
                    type="datetime-local"
                    value={inVal}
                    onChange={(e) => setInVal(e.target.value)}
                    className="tap w-full rounded-lg border border-[var(--color-pos-border)] px-2"
                  />
                </label>
                <label className="block text-xs">
                  Out
                  <input
                    type="datetime-local"
                    value={outVal}
                    onChange={(e) => setOutVal(e.target.value)}
                    className="tap w-full rounded-lg border border-[var(--color-pos-border)] px-2"
                  />
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      void patch(c.id, { clock_in: inVal, clock_out: outVal || null })
                    }
                    className="carbon-btn-primary h-8 px-3 text-xs font-semibold"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="carbon-btn-secondary h-8 px-3 text-xs font-semibold"
                  >
                    Cancel
                  </button>
                </div>
              </li>
            );
          }
          return (
            <li key={c.id} className="py-2">
              <p>
                {fmt(c.clock_in)} →{" "}
                {c.clock_out ? (
                  fmt(c.clock_out)
                ) : (
                  <span className="text-emerald-700 font-semibold">still on</span>
                )}
              </p>
              <p className="text-xs text-[var(--color-pos-muted)]">
                {(minutes / 60).toFixed(2)} hours{c.clock_out ? "" : " so far"}
              </p>
              <div className="flex gap-3 mt-1 text-xs">
                {!c.clock_out && (
                  <button
                    type="button"
                    onClick={() => void patch(c.id, { clock_out: "now" })}
                    className="text-carbon-blue font-semibold hover:underline"
                  >
                    Clock out now
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setInVal(toLocalInput(c.clock_in, tz));
                    setOutVal(c.clock_out ? toLocalInput(c.clock_out, tz) : "");
                    setEditing(c.id);
                  }}
                  className="text-carbon-blue font-semibold hover:underline"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => void remove(c.id)}
                  className="text-[var(--color-pos-danger)] font-semibold hover:underline"
                >
                  Delete
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
