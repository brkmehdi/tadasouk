// Meta sends the merchant back here with a code. It becomes a token, sealed in a cookie, and the
// merchant lands on the video import again, now able to pick an Instagram video.
//
// A code works once, and a browser may load this address twice (seen in Chrome: every navigation
// doubled). So the GET only answers a small page, and that page, which runs once, posts the code.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { currentUser } from "@/lib/server/auth";
import { COOKIE_DAYS, exchangeCode, findAccount, seal, STATE_COOKIE, TOKEN_COOKIE } from "@/lib/server/instagram";

const PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Instagram</title>
<p style="font:16px system-ui;text-align:center;margin-top:40vh">Connexion à Instagram…</p>
<script>
const q = new URLSearchParams(location.search);
fetch(location.pathname, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: q.get("code"), state: q.get("state"), error: q.get("error") }) })
  .then((r) => r.json()).catch(() => ({ result: "failed" }))
  .then((d) => location.replace("/app?instagram=" + encodeURIComponent(d.result || "failed")));
</script>`;

export function GET() {
  return new Response(PAGE, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const answer = (result: string) => NextResponse.json({ result });
  const body = (await req.json().catch(() => ({}))) as { code?: string; state?: string; error?: string };
  const state = (await cookies()).get(STATE_COOKIE)?.value;
  const user = await currentUser();
  if (!user) return answer("failed");
  if (!body.code || !state || body.state !== state) {
    console.error("instagram callback refused:", !body.code ? `no code (${body.error ?? "no error"})` : !state ? "no state cookie" : "state differs");
    return answer(body.error ? "cancelled" : "failed");
  }

  try {
    const token = await exchangeCode(body.code, url.origin);
    const account = await findAccount(token);
    const res = answer(account ? "connected" : "no_account");
    res.cookies.set(TOKEN_COOKIE, await seal({ user: user.id, token, account }), {
      httpOnly: true,
      secure: url.protocol === "https:",
      sameSite: "lax",
      path: "/api/instagram",
      maxAge: COOKIE_DAYS * 86_400,
    });
    res.cookies.delete({ name: STATE_COOKIE, path: "/api/instagram" });
    return res;
  } catch (err) {
    console.error("instagram callback", err instanceof Error ? err.message : err);
    return answer("failed");
  }
}
