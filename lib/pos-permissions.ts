import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { verifyOverride } from "@/lib/override";
import { PERM_LABEL, type PermKey, type PermMap, type PermMode } from "@/lib/permission-keys";

/**
 * POS role permissions (WMS → Users & roles → POS → POS roles, stored on
 * user_roles.permissions, scope 'pos'). The super admin (role 'admin')
 * and roles with no permissions set have full access; a missing key
 * means allowed.
 */

type Who = { employee_id: number; role: string; lid: string };

export async function loadPermissions(who: Who): Promise<PermMap> {
  if (who.role === "admin") return {};
  const r = await getPool().query<{ permissions: Record<string, Record<string, string>> | null }>(
    `SELECT ur.permissions
       FROM pos_employees pe
       JOIN user_roles ur ON ur.id = pe.pos_role_id AND ur.scope = 'pos'
      WHERE pe.id = $1`,
    [who.employee_id],
  );
  const raw = r.rows[0]?.permissions ?? {};
  const out: PermMap = {};
  for (const key of Object.keys(PERM_LABEL) as PermKey[]) {
    const [page, section] = key.split(".");
    const v = raw?.[page]?.[section];
    if (v === "hide" || v === "approval") out[key] = v;
  }
  return out;
}

export async function permissionMode(who: Who, key: PermKey): Promise<PermMode> {
  return (await loadPermissions(who))[key] ?? "view";
}

/**
 * Gate a role-controlled action. 'hide' → refused; 'approval' → needs a
 * super admin approval token (override kind 'permission', ref
 * "<key>:<nonce>") that hasn't been used before. Returns null when the
 * action may proceed, else the error response to send.
 */
export async function guardPermission(
  who: Who,
  key: PermKey,
  approval?: { token?: string | null; nonce?: string | null } | null,
): Promise<NextResponse | null> {
  const mode = await permissionMode(who, key);
  if (mode === "view") return null;
  if (mode === "hide") {
    return NextResponse.json(
      { error: "not_allowed", message: `Your role isn't allowed to ${PERM_LABEL[key]}.` },
      { status: 403 },
    );
  }
  const by =
    approval?.token && approval?.nonce
      ? verifyOverride(approval.token, "permission", `${key}:${approval.nonce}`, who.lid)
      : null;
  if (!by) {
    return NextResponse.json(
      {
        error: "approval_required",
        permission: key,
        message: `Your role needs the super admin's approval to ${PERM_LABEL[key]}.`,
      },
      { status: 403 },
    );
  }
  if (!(await consumeApproval(approval!.token!, key))) {
    return NextResponse.json(
      { error: "approval_used", message: "That approval was already used — ask again." },
      { status: 403 },
    );
  }
  return null;
}

/** Mark an approval token as used; false if it was used before. */
export async function consumeApproval(token: string, usedFor: string): Promise<boolean> {
  const hash = createHash("sha256").update(token).digest("hex");
  const r = await getPool().query(
    `INSERT INTO pos_approval_uses (token_hash, used_for) VALUES ($1, $2)
     ON CONFLICT (token_hash) DO NOTHING RETURNING token_hash`,
    [hash, usedFor],
  );
  return (r.rowCount ?? 0) > 0;
}
