// Sends the merchant to Meta to choose the Instagram account SmallStore may read. The state cookie
// proves, on the way back, that this browser asked. A second request while the first login is still
// open keeps the same state: a fresh one would make that login fail on its return.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { currentUser } from "@/lib/server/auth";
import { loginUrl, STATE_COOKIE } from "@/lib/server/instagram";

export async function GET(req: Request) {
  const { origin } = new URL(req.url);
  if (!(await currentUser())) return NextResponse.redirect(`${origin}/app`);
  const state = (await cookies()).get(STATE_COOKIE)?.value ?? crypto.randomUUID();
  const res = NextResponse.redirect(loginUrl(origin, state));
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: origin.startsWith("https:"),
    sameSite: "lax",
    path: "/api/instagram",
    maxAge: 600,
  });
  return res;
}
