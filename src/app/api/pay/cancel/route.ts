// The merchant cancels the QR on screen: the payment can no longer be paid (POST
// /payments/{id}/cancel). If the customer paid in the meantime, the answer says so and the sale
// is recorded instead.

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { cancelPayment, getPayment, PAYMENT_ID, payErrorResponse, recordPaid, requireTct } from "@/lib/server/tchentchen";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { id } = (await req.json().catch(() => ({}))) as { id?: string };
    if (typeof id !== "string" || !PAYMENT_ID.test(id)) return NextResponse.json({ error: "bad_request" }, { status: 400 });
    const cfg = await requireTct();
    const [store] = await withDb((sql) => sql<{ id: string }[]>`select id from public.stores where owner_id = ${user.id}::uuid`);
    const p = await getPayment(cfg, id);
    if (!store || p.metadata?.seller_id !== store.id || !p.reference.startsWith("qr_")) return NextResponse.json({ error: "not_found" }, { status: 404 });

    let now = p;
    if (now.status === "open") {
      // Paid between the read and the cancel: Tchentchen refuses the cancel, the payment says paid.
      now = await cancelPayment(cfg, id).catch(() => getPayment(cfg, id));
    }
    if (now.status === "paid") await withDb((sql) => recordPaid(sql, cfg, now));
    return NextResponse.json({ status: now.status });
  } catch (err) {
    return payErrorResponse(err);
  }
}
