// Owner actions on an account: activate its AI ($2 welcome credit, once) or give it more credit.

import { NextResponse } from "next/server";
import { adminUser } from "@/lib/server/admin";
import { withDb } from "@/lib/server/db";

type Body = { userId?: string; action?: "activate" | "gift"; amount?: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const admin = await adminUser();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as Body;
  if (!body.userId || !UUID.test(body.userId)) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  if (body.action === "activate") {
    await withDb((sql) => sql`select public.ai_activate(${body.userId!}::uuid, ${admin.id}::uuid)`);
    return NextResponse.json({ ok: true });
  }
  if (body.action === "gift") {
    const amount = Number(body.amount);
    if (!(amount > 0 && amount <= 100)) return NextResponse.json({ error: "bad_amount" }, { status: 400 });
    await withDb(
      (sql) => sql`select public.ai_add_credit(${body.userId!}::uuid, 'gift', ${amount}::numeric,
        ${`gift-${body.userId}-${Date.now()}`}, ${admin.id}::uuid)`,
    );
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "bad_action" }, { status: 400 });
}
