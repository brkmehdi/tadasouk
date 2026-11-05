// "Se déconnecter" from any page (back office, admin, sign-in page): ends this browser's session
// only (other devices stay signed in), clears the session cookies, then opens the sign-in page.
// POST only, and only from our own pages: a link, an image or a form on another site cannot sign
// anyone out.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { serverSupabase } from "@/lib/server/auth";

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const crossSite = req.headers.get("sec-fetch-site") === "cross-site" || (origin != null && origin !== "null" && new URL(origin).host !== req.headers.get("host"));
  if (crossSite || origin === "null") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await (await serverSupabase()).auth.signOut({ scope: "local" }).catch(() => null);
  const res = NextResponse.redirect(new URL("/connexion", req.url), 303);
  // The session lives in sb-... cookies (split in .0, .1 when long): drop any left over.
  for (const c of (await cookies()).getAll()) {
    if (c.name.startsWith("sb-")) res.cookies.set(c.name, "", { path: "/", maxAge: 0 });
  }
  return res;
}
