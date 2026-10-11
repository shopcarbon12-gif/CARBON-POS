"use client";

import { useEffect, useState } from "react";
import type { PermKey, PermMap, PermMode } from "@/lib/permission-keys";

/**
 * This employee's POS role permissions (from WMS POS roles). Fetched once
 * per page load and shared. Until loaded everything reads "view"; the
 * server enforces regardless.
 */
let cache: Promise<{ is_admin: boolean; permissions: PermMap }> | null = null;

function load() {
  cache ??= fetch("/api/pos/me/permissions")
    .then((r) => (r.ok ? r.json() : { is_admin: false, permissions: {} }))
    .catch(() => ({ is_admin: false, permissions: {} }));
  return cache;
}

export function usePermissions() {
  const [perms, setPerms] = useState<PermMap>({});
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void load().then((d) => {
      if (!live) return;
      setPerms(d.permissions ?? {});
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, []);
  return {
    ready,
    mode: (key: PermKey): PermMode => perms[key] ?? "view",
    allowed: (key: PermKey) => (perms[key] ?? "view") !== "hide",
  };
}
