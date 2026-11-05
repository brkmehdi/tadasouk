// A credit said out loud -> a draft for the "New credit" form. The merchant says, in French,
// Darija or English, "Ahmed a pris deux bouteilles d'huile pour 240 dirhams, il paiera vendredi";
// muse-spark-1.3 returns the customer, what was taken, the amount and when it will be paid. The
// next 21 days are listed in the prompt, so "vendredi" or "la semaine prochaine" needs no date
// arithmetic from the model. Nothing is saved here: the merchant checks the form and saves it.

import { NextResponse } from "next/server";
import { aiContext, errorResponse, responsesJson } from "@/lib/server/meta";
import { chatCost, PRICES, reserve, settle } from "@/lib/server/usage";

type Body = {
  sessionId: string;
  text: string;
  lang?: "fr" | "en";
  names?: string[];
};
type CreditDraft = {
  customer_name: string;
  phone: string;
  note: string;
  amount: number;
  installments: number;
  interval_days: number;
  first_due: string;
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["customer_name", "phone", "note", "amount", "installments", "interval_days", "first_due"],
  properties: {
    customer_name: { type: "string" },
    phone: { type: "string" },
    note: { type: "string" },
    amount: { type: "number" },
    installments: { type: "integer" },
    interval_days: { type: "integer" },
    first_due: { type: "string" },
  },
};

const TZ = "Africa/Casablanca";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// The next 21 days in Morocco, one per line: "2026-11-06 vendredi / Friday".
function calendar() {
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const fr = new Intl.DateTimeFormat("fr-FR", {
    timeZone: TZ,
    weekday: "long",
  });
  const en = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    weekday: "long",
  });
  return Array.from({ length: 21 }, (_, i) => {
    const d = new Date(Date.now() + i * 86_400_000);
    return `${iso.format(d)} ${fr.format(d)} / ${en.format(d)}${i === 0 ? " (today)" : i === 1 ? " (tomorrow)" : ""}`;
  });
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const { sessionId, text } = body;
  const names = Array.isArray(body.names) ? body.names.filter((n) => typeof n === "string" && n.length <= 80).slice(0, 100) : [];
  if (!sessionId || typeof text !== "string" || !text.trim() || text.length > 1500) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  try {
    const ctx = await aiContext();
    const days = calendar();
    const ask =
      "A shop owner in Morocco records a sale on credit by voice (French, Moroccan Darija in Latin or Arabic letters, or English; " +
      "the transcription can have small errors). Turn it into a credit for their ledger.\n" +
      '- customer_name: the customer\'s name, capitalised ("Ahmed", "Mme Fatima"). ' +
      (names.length ? `If it is one of the shop's existing customers, write it exactly as listed: ${names.join(", ")}. ` : "") +
      "Empty string if no name is said.\n" +
      '- phone: the phone number if one is said, digits only ("0612345678"), else empty string.\n' +
      `- note: what was taken, short, in ${body.lang === "en" ? "English" : "French"} (\"2 bouteilles d'huile\"). Empty string if not said.\n` +
      '- amount: the total owed in dirhams. A quantity with a unit price ("deux bouteilles à 60 dirhams", "60 dh l\'une") means ' +
      'quantity x unit price; "pour 240", "en tout", "total" is the total. Numbers can be said in words or in Darija ' +
      '("miya" 100, "mitin" 200, "khamsin" 50, "jouj" 2, "tlata" 3). 0 if no amount is said.\n' +
      '- installments: how many payments. One date or one day said ("vendredi", "nhar jem3a", "à la fin du mois") means 1. ' +
      '"en 3 fois", "3 mois" means 3. 0 if nothing is said about when or how they will pay.\n' +
      '- interval_days: days between payments: 7 for weekly ("chaque semaine", "kol simana"), 14 for every two weeks, ' +
      "30 for monthly. 0 if not said.\n" +
      "- first_due: the date of the first (or only) payment, YYYY-MM-DD, taken from the calendar below. A weekday means the " +
      'next one after today. "la semaine prochaine" means today + 7 days, "le mois prochain" today + 30 days. ' +
      "Empty string if no date is said.\n" +
      `Calendar (Africa/Casablanca):\n${days.join("\n")}\n\n` +
      `What the shop owner said: «${text.trim()}»`;
    const p = PRICES["muse-spark-1.3"];
    const r = await reserve(ctx, sessionId, "muse-spark-1.3", "/responses credit", 3000 * p.input + 4000 * p.output);
    try {
      const { parsed, usage } = await responsesJson<CreditDraft>(
        {
          model: "muse-spark-1.3",
          reasoning: { effort: "low" },
          max_output_tokens: 4000,
          input: [{ role: "user", content: [{ type: "input_text", text: ask }] }],
        },
        "credit_draft",
        SCHEMA,
      );
      const entry = await settle(r, chatCost(usage), true, {
        outputTokens: usage.completion_tokens ?? 0,
      });
      if (!parsed) return NextResponse.json({ error: "no_result" }, { status: 502 });
      const draft: CreditDraft = {
        customer_name: String(parsed.customer_name ?? "")
          .trim()
          .slice(0, 80),
        phone: String(parsed.phone ?? "")
          .replace(/[^\d+]/g, "")
          .slice(0, 16),
        note: String(parsed.note ?? "")
          .trim()
          .slice(0, 200),
        amount: Number.isFinite(parsed.amount) && parsed.amount > 0 ? Math.round(parsed.amount * 100) / 100 : 0,
        installments: Number.isInteger(parsed.installments) && parsed.installments >= 1 && parsed.installments <= 12 ? parsed.installments : 0,
        interval_days: Number.isInteger(parsed.interval_days) && parsed.interval_days >= 1 && parsed.interval_days <= 365 ? parsed.interval_days : 0,
        first_due: DAY.test(parsed.first_due ?? "") ? parsed.first_due : "",
      };
      return NextResponse.json({ draft, latencyMs: entry.latencyMs });
    } catch (err) {
      await settle(r, 0, false);
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
}
