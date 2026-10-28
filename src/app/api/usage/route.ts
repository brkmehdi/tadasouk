// AI credit of the signed-in account: free allowance left today, prepaid balance, and what can
// still be spent now (calls in flight are held). The capture screen uses it for the 80% alert.

import { connection, NextResponse } from "next/server";
import { aiContext, errorResponse } from "@/lib/server/meta";
import { creditStatus } from "@/lib/server/usage";

export async function GET() {
  await connection();
  try {
    const credit = await creditStatus(await aiContext());
    return NextResponse.json(credit, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
