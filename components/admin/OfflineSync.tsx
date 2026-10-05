"use client";

import { useEffect, useState } from "react";
import { formatMoney } from "@/lib/utils";
import {
  discardOfflineSale,
  QUEUE_EVENT,
  readQueue,
  syncOfflineSales,
  type OfflineSale,
} from "@/lib/offline-queue";

/**
 * Top-bar status for offline cash sales waiting on this register. Syncs
 * them automatically (on load, every 20 s, and when the browser comes
 * back online) and lists any the server rejected so a person can retry
 * or discard. Also registers the service worker that lets the POS pages
 * reload without internet.
 */
export function OfflineSync() {
  const [queue, setQueue] = useState<OfflineSale[]>([]);
  const [open, setOpen] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const refresh = () => setQueue(readQueue());
    const sync = () => void syncOfflineSales().then(refresh);
    refresh();
    sync();
    const t = setInterval(sync, 20_000);
    const onOnline = () => {
      setOffline(false);
      sync();
    };
    const onOffline = () => setOffline(true);
    setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    window.addEventListener(QUEUE_EVENT, refresh);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    return () => {
      clearInterval(t);
      window.removeEventListener(QUEUE_EVENT, refresh);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const failed = queue.filter((s) => s.error);
  if (queue.length === 0 && !offline) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 h-9 px-3 border text-sm font-semibold ${
          failed.length
            ? "border-red-600 text-red-700 bg-red-50"
            : offline
              ? "border-amber-600 text-amber-800 bg-amber-50"
              : "border-carbon-border text-carbon-text bg-white"
        }`}
      >
        <span className="material-symbols-outlined text-[18px]" aria-hidden>
          {offline ? "cloud_off" : failed.length ? "error" : "sync"}
        </span>
        {offline
          ? queue.length
            ? `Offline · ${queue.length} to sync`
            : "Offline"
          : failed.length
            ? `${failed.length} offline sale${failed.length === 1 ? "" : "s"} need attention`
            : `Syncing ${queue.length}…`}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-80 bg-white border border-carbon-border shadow-lg p-3 text-sm">
          <p className="font-semibold mb-1">Offline cash sales on this register</p>
          <p className="text-xs text-carbon-text-muted mb-2">
            They send automatically when the internet is back. Don&apos;t clear
            this browser&apos;s data until they&apos;re gone from this list.
          </p>
          {queue.length === 0 ? (
            <p className="text-carbon-text-muted">Nothing waiting.</p>
          ) : (
            <ul className="divide-y divide-carbon-border-soft max-h-72 overflow-y-auto">
              {queue.map((s) => (
                <li key={s.client_uuid} className="py-2">
                  <div className="flex justify-between">
                    <span>
                      {new Date(s.created_at).toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                    <span className="font-semibold tabular-nums">{formatMoney(s.total)}</span>
                  </div>
                  {s.error && (
                    <>
                      <p className="text-xs text-red-700 mt-1">{s.error}</p>
                      <div className="flex gap-3 mt-1 text-xs font-semibold">
                        <button
                          type="button"
                          className="text-carbon-blue hover:underline"
                          onClick={() => void syncOfflineSales({ includeFailed: true }).then(() => setQueue(readQueue()))}
                        >
                          Retry
                        </button>
                        <button
                          type="button"
                          className="text-red-700 hover:underline"
                          onClick={() => {
                            if (confirm("Discard this offline sale? It will NOT be recorded.")) {
                              discardOfflineSale(s.client_uuid);
                            }
                          }}
                        >
                          Discard
                        </button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
