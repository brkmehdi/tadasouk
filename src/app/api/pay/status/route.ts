// The merchant's screen asks every 2 s whether the QR payment is paid. The server reads it from
// Tchentchen (GET /payments/{id}); it must be an in-shop payment of this merchant's store (its
// metadata says which). Once paid it is recorded here (once per payment), so the sale counts even
// before the event lands.

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { getPayment, PAYMENT_ID, payErrorResponse, recordPaid, requireTct } from "@/lib/server/tchentchen";

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const id = new URL(req.url).searchParams.get("id") ?? "";
    if (!PAYMENT_ID.test(id)) return NextResponse.json({ error: "bad_request" }, { status: 400 });
    const cfg = await requireTct();
    const [store] = await withDb((sql) => sql<{ id: string }[]>`select id from public.stores where owner_id = ${user.id}::uuid`);
    const p = await getPayment(cfg, id);
    if (!store || p.metadata?.seller_id !== store.id || !p.reference.startsWith("qr_")) return NextResponse.json({ error: "not_found" }, { status: 404 });

    if (p.status === "paid") await withDb((sql) => recordPaid(sql, cfg, p));
    const m = p.payment_method;
    return NextResponse.json({
      status: p.status,
      method: m ? { wallet: m.wallet, brand: m.brand, last4: m.last4 } : null,
      amount: p.amount,
      currency: p.currency,
    });
  } catch (err) {
    return payErrorResponse(err);
  }
}
