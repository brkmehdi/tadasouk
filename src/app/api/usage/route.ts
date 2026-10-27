// Spend so far for one capture session and for today, plus the latest calls.

import { connection, NextResponse } from "next/server";
import { summary } from "@/lib/server/usage";

export async function GET(req: Request) {
  await connection();
  const sessionId = new URL(req.url).searchParams.get("sessionId") ?? undefined;
  return NextResponse.json(summary(sessionId), { headers: { "Cache-Control": "no-store" } });
}
