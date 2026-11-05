// The merchant's Instagram videos, newest first; DELETE forgets the account on this phone.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/server/auth";
import { errorResponse } from "@/lib/server/meta";
import { COOKIE_DAYS, findAccount, listVideos, NotLinkedError, seal, TOKEN_COOKIE, unseal } from "@/lib/server/instagram";

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const store = await cookies();
    const link = await unseal(store.get(TOKEN_COOKIE)?.value, user.id);
    if (!link.account) {
      link.account = await findAccount(link.token);
      if (!link.account) return NextResponse.json({ error: "no_account" }, { status: 409 });
      const res = NextResponse.json({ username: link.account.username, videos: await listVideos(link) });
      res.cookies.set(TOKEN_COOKIE, await seal(link), {
        httpOnly: true,
        secure: req.url.startsWith("https:"),
        sameSite: "lax",
        path: "/api/instagram",
        maxAge: COOKIE_DAYS * 86_400,
      });
      return res;
    }
    return NextResponse.json({ username: link.account.username, videos: await listVideos(link) });
  } catch (err) {
    if (err instanceof NotLinkedError) return NextResponse.json({ error: "not_linked" }, { status: 409 });
    return errorResponse(err);
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete({ name: TOKEN_COOKIE, path: "/api/instagram" });
  return res;
}
