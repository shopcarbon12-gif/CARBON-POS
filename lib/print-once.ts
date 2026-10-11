"use client";

/**
 * Receipt screens print automatically when they open — but only once per
 * receipt on this device, so going back / refreshing doesn't print a
 * second copy (the Print button is there for reprints).
 */
export function claimAutoPrint(key: string): boolean {
  try {
    const k = `pos:printed:${key}`;
    if (sessionStorage.getItem(k)) return false;
    sessionStorage.setItem(k, String(Date.now()));
    return true;
  } catch {
    return true;
  }
}
