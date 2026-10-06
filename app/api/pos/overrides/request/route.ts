import { NextResponse } from "next/server";
import { z } from "zod";
import { randomInt } from "node:crypto";
import { Resend } from "resend";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import {
  hashOverrideCode,
  OVERRIDE_KINDS,
  OVERRIDE_LABEL,
  overrideApproverEmail,
} from "@/lib/override";

const schema = z.object({
  kind: z.enum(OVERRIDE_KINDS),
  ref: z.string().min(1).max(100),
  detail: z.string().max(500).optional(),
});

/**
 * POST /api/pos/overrides/request { kind, ref, detail }
 * Emails the approver a one-time 6-digit code for this exact override
 * (kind + ref). Hand the code to the employee, who enters it at
 * /api/pos/overrides/approve. 15 minutes, 5 tries, single use.
 */
export async function POST(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const { kind, ref, detail } = parsed.data;
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "email_not_configured", message: "Email isn't set up — use an admin PIN." },
      { status: 503 },
    );
  }
  const pool = getPool();
  const who = await pool.query(
    `SELECT COALESCE(NULLIF(TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')), ''), u.email) AS name,
            (SELECT l.name FROM locations l WHERE l.id = $2::uuid) AS store,
            (SELECT id FROM pos_locations WHERE wms_location_id = $2::uuid LIMIT 1) AS pos_location_id
       FROM users u WHERE u.id = $1::uuid`,
    [cashier.user_id, cashier.lid],
  );
  const requester = who.rows[0]?.name ?? cashier.email ?? "An employee";
  const store = who.rows[0]?.store ?? "the store";
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const approver = overrideApproverEmail();
  const ins = await pool.query<{ id: number }>(
    `INSERT INTO pos_override_requests
       (pos_location_id, kind, ref, detail, code_hash, requested_by, requested_by_email, sent_to, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() + interval '15 minutes')
     RETURNING id`,
    [
      who.rows[0]?.pos_location_id ?? null,
      kind,
      ref,
      detail ?? null,
      hashOverrideCode(code, kind, ref),
      cashier.employee_id,
      cashier.email,
      approver,
    ],
  );
  const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px">
    <h2 style="margin:0 0 12px">Override request — ${esc(store)}</h2>
    <p><b>${esc(requester)}</b> is asking to:</p>
    <p style="font-size:16px"><b>${esc(OVERRIDE_LABEL[kind])}</b></p>
    ${detail ? `<p style="background:#f4f4f5;padding:10px">${esc(detail)}</p>` : ""}
    <p>If you approve, give them this code:</p>
    <p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:8px 0">${code}</p>
    <p style="color:#666;font-size:13px">Works once, for this request only, for 15 minutes.
      If you don't approve, ignore this email.</p>
  </div>`;
  try {
    const { error } = await new Resend(apiKey).emails.send({
      from: process.env.RECEIPT_FROM_EMAIL || "receipts@shopcarbon.com",
      to: approver,
      subject: `Override request from ${requester}: ${OVERRIDE_LABEL[kind]}`,
      html,
    });
    if (error) throw new Error(`${error.name}: ${error.message}`);
  } catch (err) {
    console.error("[overrides/request] email", err);
    await pool.query(`DELETE FROM pos_override_requests WHERE id = $1`, [ins.rows[0].id]);
    return NextResponse.json(
      { error: "send_failed", message: "Couldn't email the code. Try again or use an admin PIN." },
      { status: 502 },
    );
  }
  return NextResponse.json({ request_id: ins.rows[0].id, sent_to: approver });
}
