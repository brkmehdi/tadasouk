// Tchentchen's connect page comes back here with a one-time code and our state (?tct_code=...&
// tct_state=...). The state must be the one in the cookie set by /api/tchentchen/connect; then the
// server claims the code (valid 10 minutes, once) and receives the test and live keys, once. Each key is encrypted (AES-GCM, secret
// TCHENTCHEN_KEYS_SECRET) before it is saved; no key is ever logged or sent to the browser.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { adminUser } from "@/lib/server/admin";
import { withDb } from "@/lib/server/db";
import { seal } from "@/lib/server/secret-box";
import { CONNECT_STATE_COOKIE, forgetConnectedKey, siteUrl, tctOrigin } from "@/lib/server/tchentchen";

type Claim = { api_key_sandbox?: unknown; api_key_live?: unknown };

function sameText(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function GET(req: Request) {
  const back = (query: string) => {
    const res = NextResponse.redirect(new URL(`/admin/tchentchen?${query}`, req.url));
    res.cookies.set(CONNECT_STATE_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/api/tchentchen", maxAge: 0 });
    return res;
  };
  const admin = await adminUser();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const q = new URL(req.url).searchParams;
  const code = q.get("tct_code") ?? "";
  const state = q.get("tct_state") ?? "";
  const expected = (await cookies()).get(CONNECT_STATE_COOKIE)?.value ?? "";
  if (!code) return back("error=refused");
  if (!/^[0-9a-f]{32}$/.test(state) || !expected || !sameText(state, expected)) return back("error=state");

  const site = siteUrl();
  const secret = (getCloudflareContext().env as unknown as { TCHENTCHEN_KEYS_SECRET?: string }).TCHENTCHEN_KEYS_SECRET?.trim();
  // The keys come only once: without a place to keep them, the code is not claimed.
  if (!site) return back("error=no_site");
  if (!secret || secret.length < 32) return back("error=no_keys_secret");

  let claim: Claim;
  try {
    const res = await fetch(`${tctOrigin()}/api/v1/module/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ code, state, shop_url: site }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const e = (await res.json().catch(() => null)) as { error?: { code?: string } | string } | null;
      const reason = typeof e?.error === "string" ? e.error : (e?.error?.code ?? "");
      console.error(`Tchentchen claim answered ${res.status} ${reason}`.trim());
      return back(`error=claim&status=${res.status}`);
    }
    claim = (await res.json()) as Claim;
  } catch (err) {
    console.error("Tchentchen claim failed", err instanceof Error ? err.name : "");
    return back("error=claim");
  }

  const sandbox = typeof claim.api_key_sandbox === "string" && claim.api_key_sandbox.startsWith("tct_test_") ? claim.api_key_sandbox : null;
  const live = typeof claim.api_key_live === "string" && claim.api_key_live.startsWith("tct_live_") ? claim.api_key_live : null;
  if (!sandbox && !live) return back("error=no_keys");

  const sealedSandbox = sandbox ? await seal(sandbox, secret, "tchentchen:sandbox") : null;
  const sealedLive = live ? await seal(live, secret, "tchentchen:live") : null;
  await withDb(
    (sql) => sql`
      insert into public.tchentchen_account (id, shop_url, sandbox_key, live_key, connected_by, connected_at)
      values (true, ${site}, ${sealedSandbox}, ${sealedLive}, ${admin.id}::uuid, now())
      on conflict (id) do update set shop_url = excluded.shop_url,
        sandbox_key = coalesce(excluded.sandbox_key, public.tchentchen_account.sandbox_key),
        live_key = coalesce(excluded.live_key, public.tchentchen_account.live_key),
        connected_by = excluded.connected_by, connected_at = excluded.connected_at`,
  );
  forgetConnectedKey();
  return back("connected=1");
}
