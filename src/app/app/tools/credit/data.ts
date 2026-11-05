// The credit book in the database, read and written with the merchant's session (row level
// security keeps it to their store). A credit writes the customer (found by phone or created),
// a +amount "sale" entry, a plan and its installments; a payment writes the payment, marks the
// installment paid and adds a -amount "payment" entry. The balance is the sum of the entries.

import { phoneDigits } from "@/lib/phone";
import { supabase } from "@/lib/supabase/browser";
import { daysFrom, SOON_DAYS, today, toneOf, type Planned, type Tone } from "./schedule";

export type Entry = {
  id: string;
  customer_id: string;
  kind: "sale" | "payment" | "adjustment";
  amount: number;
  note: string | null;
  created_at: string;
};
export type Installment = {
  id: string;
  plan_id: string;
  due_on: string;
  amount: number;
  paid_at: string | null;
  reminded_at: string | null;
  method: string | null;
};
export type Plan = {
  id: string;
  customer_id: string;
  count: number;
  interval_days: number;
  created_at: string;
  note: string | null;
  installments: Installment[];
};
export type Customer = {
  id: string;
  name: string;
  phone: string;
  balance: number;
  entries: Entry[]; // newest first
  plans: Plan[]; // newest first
  open: Installment[]; // unpaid, earliest first
  tone: Tone;
  late: number;
  reminded: string | null; // last reminder sent
};
export type Book = {
  customers: Customer[];
  owed: number;
  late: number;
  week: number;
  defaultCount: number;
};

const num = (v: unknown) => Number(v ?? 0);
const RANK: Record<Tone, number> = { late: 0, soon: 1, ok: 2, done: 3 };

export async function loadBook(storeId: string): Promise<Book> {
  const db = supabase();
  const [entries, plans, installments, payments, store] = await Promise.all([
    db.from("credit_entries").select("id, customer_id, kind, amount, note, created_at").order("created_at", { ascending: false }),
    db.from("installment_plans").select("id, customer_id, count, interval_days, created_at").order("created_at", { ascending: false }),
    db.from("installments").select("id, plan_id, due_on, amount, paid_at, reminded_at").order("due_on"),
    db.from("payments").select("installment_id, method").not("installment_id", "is", null),
    db.from("stores").select("default_installments").eq("id", storeId).maybeSingle(),
  ]);
  const err = entries.error ?? plans.error ?? installments.error ?? payments.error;
  if (err) throw new Error(err.message);

  const E = (entries.data ?? []).map((e) => ({ ...e, amount: num(e.amount) }) as Entry);
  const methods = new Map((payments.data ?? []).map((p) => [p.installment_id as string, p.method as string]));
  const I = (installments.data ?? []).map(
    (i) =>
      ({
        ...i,
        amount: num(i.amount),
        method: methods.get(i.id) ?? null,
      }) as Installment,
  );
  const ids = [...new Set([...E.map((e) => e.customer_id), ...(plans.data ?? []).map((p) => p.customer_id as string)])];
  const people = ids.length ? await db.from("customers").select("id, name, phone").in("id", ids) : { data: [], error: null };
  if (people.error) throw new Error(people.error.message);

  // A plan has no link to its sale entry: they are written together, so the closest one in time.
  const P: Plan[] = (plans.data ?? []).map((p) => {
    const at = Date.parse(p.created_at);
    const sale = E.filter((e) => e.kind === "sale" && e.customer_id === p.customer_id && Math.abs(Date.parse(e.created_at) - at) < 120_000).sort(
      (a, b) => Math.abs(Date.parse(a.created_at) - at) - Math.abs(Date.parse(b.created_at) - at),
    )[0];
    return {
      ...(p as Omit<Plan, "note" | "installments">),
      note: sale?.note ?? null,
      installments: I.filter((i) => i.plan_id === p.id),
    };
  });

  const now = today();
  const customers = (people.data ?? []).map((c): Customer => {
    const plansOf = P.filter((p) => p.customer_id === c.id);
    const open = plansOf
      .flatMap((p) => p.installments)
      .filter((i) => !i.paid_at)
      .sort((a, b) => a.due_on.localeCompare(b.due_on));
    const balance = Math.round(E.filter((e) => e.customer_id === c.id).reduce((s, e) => s + e.amount, 0) * 100) / 100;
    const tone: Tone = balance <= 0 && open.length === 0 ? "done" : open.length ? toneOf(open[0].due_on, now) : "ok";
    const reminded = plansOf
      .flatMap((p) => p.installments)
      .map((i) => i.reminded_at)
      .filter((r): r is string => !!r)
      .sort()
      .at(-1);
    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      balance,
      entries: E.filter((e) => e.customer_id === c.id),
      plans: plansOf,
      open,
      tone,
      late: open.filter((i) => i.due_on < now).reduce((s, i) => s + i.amount, 0),
      reminded: reminded ?? null,
    };
  });
  customers.sort((a, b) => RANK[a.tone] - RANK[b.tone] || (a.open[0]?.due_on ?? "9").localeCompare(b.open[0]?.due_on ?? "9") || b.balance - a.balance);

  const unpaid = I.filter((i) => !i.paid_at);
  return {
    customers,
    owed: customers.reduce((s, c) => s + Math.max(0, c.balance), 0),
    late: unpaid.filter((i) => i.due_on < now).reduce((s, i) => s + i.amount, 0),
    week: unpaid.filter((i) => i.due_on >= now && daysFrom(now, i.due_on) < SOON_DAYS).reduce((s, i) => s + i.amount, 0),
    defaultCount: num(store.data?.default_installments) || 3,
  };
}

export type NewCredit = {
  name: string;
  phone: string;
  amount: number;
  note: string;
  intervalDays: number;
  schedule: Planned[];
};

// Returns the customer's id. Undoes the plan when a later step fails, so no half credit stays.
export async function saveCredit(storeId: string, c: NewCredit) {
  const db = supabase();
  const phone = phoneDigits(c.phone);
  const found = await db.from("customers").select("id").eq("phone", phone).maybeSingle();
  if (found.error) throw new Error(found.error.message);
  let customerId = found.data?.id as string | undefined;
  if (!customerId) {
    const made = await db.from("customers").insert({ store_id: storeId, name: c.name.trim(), phone }).select("id").single();
    if (made.error) throw new Error(made.error.message);
    customerId = made.data.id as string;
  }
  const plan = await db
    .from("installment_plans")
    .insert({
      store_id: storeId,
      customer_id: customerId,
      count: c.schedule.length,
      interval_days: c.intervalDays,
    })
    .select("id")
    .single();
  if (plan.error) throw new Error(plan.error.message);
  const rows = c.schedule.map((s) => ({
    plan_id: plan.data.id,
    store_id: storeId,
    due_on: s.due_on,
    amount: s.amount,
  }));
  const inst = await db.from("installments").insert(rows);
  const entry = inst.error
    ? null
    : await db.from("credit_entries").insert({
        store_id: storeId,
        customer_id: customerId,
        kind: "sale",
        amount: c.amount,
        note: c.note.trim() || null,
      });
  const failed = inst.error ?? entry?.error;
  if (failed) {
    await db.from("installment_plans").delete().eq("id", plan.data.id);
    throw new Error(failed.message);
  }
  return customerId;
}

// Marks one installment paid. False when it was already paid (a second tap, another phone).
export async function markPaid(storeId: string, customerId: string, i: Installment, method: "cash" | "transfer", note: string) {
  const db = supabase();
  const paidAt = new Date().toISOString();
  const upd = await db.from("installments").update({ paid_at: paidAt }).eq("id", i.id).is("paid_at", null).select("id");
  if (upd.error) throw new Error(upd.error.message);
  if (!upd.data?.length) return false;
  const pay = await db.from("payments").insert({
    store_id: storeId,
    installment_id: i.id,
    method,
    provider: "cash",
    amount: i.amount,
    received_at: paidAt,
  });
  const entry = pay.error
    ? null
    : await db.from("credit_entries").insert({
        store_id: storeId,
        customer_id: customerId,
        kind: "payment",
        amount: -i.amount,
        note,
      });
  const failed = pay.error ?? entry?.error;
  if (failed) {
    await db.from("installments").update({ paid_at: null }).eq("id", i.id);
    throw new Error(failed.message);
  }
  return true;
}

export async function setReminded(ids: string[]) {
  if (!ids.length) return;
  await supabase().from("installments").update({ reminded_at: new Date().toISOString() }).in("id", ids);
}

export async function saveRib(storeId: string, rib: string) {
  const { error } = await supabase()
    .from("stores")
    .update({ rib: rib.trim() || null })
    .eq("id", storeId);
  if (error) throw new Error(error.message);
}
