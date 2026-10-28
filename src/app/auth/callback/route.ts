// Where Google sign-in and the email confirmation link come back: the one-time code becomes a
// session cookie, then the merchant goes on to the back office.

import { NextResponse } from "next/server";
import { serverSupabase } from "@/lib/server/auth";

// Only paths of this site, so the link cannot send anyone elsewhere.
function safeNext(next: string | null) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/app";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (code) {
    const { error } = await (await serverSupabase()).auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(safeNext(url.searchParams.get("next")), url.origin));
  }
  return NextResponse.redirect(new URL("/connexion?erreur=lien", url.origin));
}
