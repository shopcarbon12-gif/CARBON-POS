import { mintWmsSessionJwt } from "@/lib/wms-session";

/**
 * Server-to-server fetch against WMS as the signed-in cashier. Derives the
 * WMS origin from WMS_EDGE_STREAM_URL so there's no separate env var to
 * maintain. The cashier's POS JWT is exchanged for a WMS-format JWT here
 * (short-lived, HS256 over the shared SESSION_SECRET).
 */
export type CashierForWmsFetch = {
  user_id: string;
  email: string | null;
  tid: string;
  lid: string;
  role: string;
};

function wmsOriginFromStreamUrl(): string | null {
  const raw = process.env.WMS_EDGE_STREAM_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

export async function wmsFetch(
  cashier: CashierForWmsFetch,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const origin = wmsOriginFromStreamUrl();
  if (!origin) {
    throw new Error(
      "WMS_EDGE_STREAM_URL not set on the POS server — cannot derive WMS origin.",
    );
  }
  const token = await mintWmsSessionJwt(cashier);
  const url = `${origin}${path.startsWith("/") ? path : "/" + path}`;
  return fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });
}
