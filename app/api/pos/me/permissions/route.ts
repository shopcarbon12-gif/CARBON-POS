import { NextResponse } from "next/server";
import { currentCashier } from "@/lib/session";
import { loadPermissions } from "@/lib/pos-permissions";

/** GET /api/pos/me/permissions — this employee's POS role permissions
 *  ({} = full access). Keys present are 'hide' or 'approval'. */
export async function GET() {
  const cashier = await currentCashier();
  if (!cashier) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({
    is_admin: cashier.role === "admin",
    permissions: await loadPermissions(cashier),
  });
}
