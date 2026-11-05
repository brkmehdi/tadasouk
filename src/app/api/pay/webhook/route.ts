// Tchentchen's payment events (the events_url of every payment we create). Checked in this order:
// the signature over the raw body (X-Tct-Signature, HMAC-SHA256 with our secret key, at most
// 5 minutes old), the event's type, whether its id was already handled. Then the payment is read
// back from Tchentchen (GET /payments/{id}) and only that answer moves money in our books:
// paid (amount equal to the order's total, store from the payment's metadata), refunded.
// The same event can come twice and in any order: recording is once per payment id anyway.

import { NextResponse } from "next/server";
import { withDb } from "@/lib/server/db";
import { getPayment, PAYMENT_ID, recordPaid, recordRefunds, tctConfig, TchentchenError, verifyEvent } from "@/lib/server/tchentchen";

const TYPES = new Set(["payment.paid", "payment.processing", "payment.expired", "payment.canceled", "payment.refunded"]);

type Event = { id?: unknown; object?: unknown; type?: unknown; data?: { object?: { id?: unknown } } };

export async function POST(req: Request) {
  const cfg = await tctConfig();
  if (!cfg) return NextResponse.json({ error: "tct_not_configured" }, { status: 503 });

  const raw = new Uint8Array(await req.arrayBuffer());
  if (!(await verifyEvent(req.headers, raw, cfg.key))) return NextResponse.json({ error: "bad_signature" }, { status: 401 });

  let event: Event;
  try {
    event = JSON.parse(new TextDecoder().decode(raw)) as Event;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const eventId = typeof event.id === "string" ? event.id.slice(0, 200) : "";
  const type = typeof event.type === "string" ? event.type : "";
  const paymentId = typeof event.data?.object?.id === "string" ? event.data.object.id : "";
  if (event.object !== "event" || !TYPES.has(type) || !eventId || !PAYMENT_ID.test(paymentId)) {
    return NextResponse.json({ error: "bad_event" }, { status: 400 });
  }

  try {
    const outcome = await withDb(async (sql) => {
      const [seen] = await sql`select 1 from public.tchentchen_events where id = ${eventId}`;
      if (seen) return "duplicate";
      let result = "noted"; // processing, expired, canceled: nothing to record, the order stays unpaid
      if (type === "payment.paid" || type === "payment.refunded") {
        const p = await getPayment(cfg, paymentId);
        if (p.status === "paid") result = await recordPaid(sql, cfg, p);
        if (p.amount_refunded > 0) {
          await recordRefunds(sql, p);
          result = "refunds";
        }
      }
      await sql`insert into public.tchentchen_events (id, type, payment_id) values (${eventId}, ${type}, ${paymentId}) on conflict (id) do nothing`;
      return result;
    });
    return NextResponse.json({ ok: true, outcome });
  } catch (err) {
    // A 5xx makes Tchentchen send the event again later.
    console.error("Tchentchen event failed", err instanceof TchentchenError || err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
