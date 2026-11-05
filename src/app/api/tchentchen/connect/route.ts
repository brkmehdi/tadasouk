// "Connect Tchentchen" (platform owner only, from /admin/tchentchen): a fresh state in an HttpOnly
// cookie, then Tchentchen's connect page. Tchentchen comes back to /api/tchentchen/connected with
// a one-time code. Started on the site's own address, where the cookie will be read back.

import { NextResponse } from "next/server";
import pkg from "../../../../../package.json";
import { adminUser } from "@/lib/server/admin";
import { CONNECT_STATE_COOKIE, siteUrl, tctOrigin } from "@/lib/server/tchentchen";

export async function GET(req: Request) {
  if (!(await adminUser())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const site = siteUrl();
  if (!site) return NextResponse.redirect(new URL("/admin/tchentchen?error=no_site", req.url));
  if (new URL(req.url).origin !== site) return NextResponse.redirect(`${site}/api/tchentchen/connect`);

  const state = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  const to = new URL("/connect/module", tctOrigin());
  to.searchParams.set("shop_url", site);
  to.searchParams.set("return_url", `${site}/api/tchentchen/connected`);
  to.searchParams.set("state", state);
  to.searchParams.set("platform", "custom");
  to.searchParams.set("version", pkg.version);

  const res = NextResponse.redirect(to.toString());
  res.cookies.set(CONNECT_STATE_COOKIE, state, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/tchentchen", maxAge: 900 });
  return res;
}
