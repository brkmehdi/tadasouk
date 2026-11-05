// Products of a sales video: see src/lib/server/extract.ts. The video itself stays on the phone.

import { NextResponse } from "next/server";
import { aiContext, errorResponse } from "@/lib/server/meta";
import { extractProducts, type Spoken } from "@/lib/server/extract";
import { chatCost, PRICES, spend } from "@/lib/server/usage";

type Body = { sessionId: string; spoken: Spoken[]; sheet: string; currency?: string; seconds: number };

const MAX_SHEET = 800_000;
const MAX_SPOKEN = 40_000; // about 10 minutes of speech

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const { sessionId, spoken, sheet, currency = "MAD", seconds } = body;
  if (
    !sessionId ||
    !Array.isArray(spoken) ||
    !spoken.every((s) => typeof s?.at === "number" && typeof s?.text === "string") ||
    spoken.reduce((n, s) => n + s.text.length, 0) > MAX_SPOKEN ||
    typeof sheet !== "string" ||
    !sheet.startsWith("data:image/jpeg;base64,") ||
    sheet.length > MAX_SHEET ||
    !(seconds > 0)
  ) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  try {
    const ctx = await aiContext();
    const p = PRICES["muse-spark-1.3"];
    const { result, entry } = await spend(
      ctx,
      sessionId,
      "muse-spark-1.3",
      "/responses extract",
      20_000 * p.input + 3000 * p.output,
      () => extractProducts(spoken, sheet, currency, seconds),
      ({ usage }) => ({ usd: chatCost(usage), detail: { inputTokens: usage.prompt_tokens ?? 0, outputTokens: usage.completion_tokens ?? 0 } }),
    );
    if (!result.parsed) return NextResponse.json({ error: "no_result" }, { status: 502 });
    return NextResponse.json({ products: result.parsed.products.slice(0, 12), latencyMs: entry.latencyMs });
  } catch (err) {
    return errorResponse(err);
  }
}
