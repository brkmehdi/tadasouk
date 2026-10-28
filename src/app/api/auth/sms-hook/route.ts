// Supabase Auth hands every phone sign-in code here instead of sending an SMS (Send SMS Hook).
// We keep the code for 10 minutes. The merchant then writes to the SmallStore WhatsApp number,
// and the WhatsApp webhook answers with the code: a reply inside the 24-hour window the
// merchant opened is a free service message, where a code we send first would be paid.

import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { withDb } from "@/lib/server/db";
import { verifyStandardWebhook } from "@/lib/server/webhook-signature";

type Payload = { user?: { phone?: string }; sms?: { otp?: string } };

const hookError = (http_code: number, message: string) =>
  NextResponse.json({ error: { http_code, message } }, { status: http_code });

export async function POST(req: Request) {
  const secret = getCloudflareContext().env.SEND_SMS_HOOK_SECRET;
  const body = await req.text();
  if (!secret || !(await verifyStandardWebhook(req.headers, body, secret))) {
    return hookError(401, "bad signature");
  }
  let payload: Payload;
  try {
    payload = JSON.parse(body) as Payload;
  } catch {
    return hookError(400, "bad json");
  }
  const phone = payload.user?.phone?.replace(/\D/g, "");
  const code = payload.sms?.otp;
  if (!phone || !code) return hookError(400, "missing phone or code");

  await withDb(
    (sql) => sql`
      insert into public.phone_codes (phone, code, expires_at, sent_at)
      values (${phone}, ${code}, now() + interval '10 minutes', null)
      on conflict (phone) do update set code = excluded.code, expires_at = excluded.expires_at, sent_at = null`,
  );
  if (process.env.NODE_ENV !== "production") {
    console.log(`[sms-hook] code for +${phone}: ${code} (local only; WhatsApp sends it in production)`);
  }
  return NextResponse.json({});
}
