// An in-shop card payment: the merchant types an amount, the phone shows the payment's pay page
// as a QR code, the customer pays on their own phone. Reference "qr_<uuid>", no return_url; the
// payment's metadata (seller_id) is what ties it to the store. GET tells the screen whether card
// payment is set up at all.

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { createPayment, payErrorResponse, payLocale, requireTct, sellerMetadata, tchentchenConfigured, TchentchenError, toMinor } from "@/lib/server/tchentchen";

type Body = { storeId?: string; amount?: number; note?: string; lang?: string };
type StoreRow = { id: string; name: string; city: string | null; currency: string };

export async function GET() {
  return NextResponse.json({ configured: await tchentchenConfigured() });
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const b = (await req.json().catch(() => ({}))) as Body;
    const amount = Number(b.amount);
    if (!b.storeId || !/^[0-9a-f-]{36}$/i.test(b.storeId) || !Number.isFinite(amount) || amount <= 0 || amount > 100000) {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }
    const cfg = await requireTct();
    const [store] = await withDb(
      (sql) => sql<StoreRow[]>`select id, name, city, currency from public.stores where id = ${b.storeId!}::uuid and owner_id = ${user.id}::uuid`,
    );
    if (!store) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const note = typeof b.note === "string" ? b.note.trim().slice(0, 80) : "";
    const reference = `qr_${crypto.randomUUID()}`;
    const p = await createPayment(
      cfg,
      {
        amount: toMinor(amount),
        currency: store.currency.toLowerCase(),
        reference,
        site_url: cfg.site,
        description: (note ? `${store.name}, ${note}` : store.name).slice(0, 120),
        metadata: sellerMetadata(store),
        events_url: `${cfg.site}/api/pay/webhook`,
        locale: payLocale(b.lang),
      },
      reference,
    );
    return NextResponse.json({ id: p.id, url: p.url, expires_at: p.expires_at });
  } catch (err) {
    if (err instanceof TchentchenError && err.code === "amount_too_small") return NextResponse.json({ error: "amount_too_small" }, { status: 400 });
    return payErrorResponse(err);
  }
}
