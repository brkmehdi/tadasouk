// Stock movements seen by the camera: written with the merchant's own session (row level
// security), one at a time so two quick scans of the same product read each other's stock.
// A movement is never deleted when undone: it keeps its row with reverted_at, and the stock goes
// back, so the camera's accuracy can be measured (1 minus undone over counted).

import { supabase } from "@/lib/supabase/browser";

export type Source = "camera_sale" | "camera_delivery";

export type Movement = {
  id: string;
  productId: string;
  delta: number;
  source: Source;
  confidence: number | null;
  revertedAt: string | null;
  createdAt: string;
  how: "barcode" | "ai" | null; // null: loaded from an earlier visit
  before: number | null; // stock before and after, when this visit wrote it
  after: number | null;
};

type Row = {
  id: string;
  product_id: string;
  delta: number;
  source: Source;
  confidence: number | string | null;
  note: string | null;
  reverted_at: string | null;
  created_at: string;
};

const COLUMNS = "id, product_id, delta, source, confidence, note, reverted_at, created_at";
export const RECENT = 20; // accuracy and "ask first" look at this many latest movements

const fromRow = (r: Row): Movement => ({
  id: r.id,
  productId: r.product_id,
  delta: r.delta,
  source: r.source,
  confidence: r.confidence == null ? null : Number(r.confidence),
  revertedAt: r.reverted_at,
  createdAt: r.created_at,
  how: r.note === "barcode" ? "barcode" : r.note?.startsWith("ai") ? "ai" : null,
  before: null,
  after: null,
});

// Today's camera movements and the latest ones before today, newest first, without duplicates.
export async function loadMovements(storeId: string): Promise<Movement[]> {
  const db = supabase();
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const base = () =>
    db
      .from("stock_movements")
      .select(COLUMNS)
      .eq("store_id", storeId)
      .in("source", ["camera_sale", "camera_delivery"])
      .order("created_at", { ascending: false });
  const [today, recent] = await Promise.all([base().gte("created_at", midnight.toISOString()).limit(300), base().limit(RECENT)]);
  const seen = new Set<string>();
  return [...(today.data ?? []), ...(recent.data ?? [])]
    .filter((r) => !seen.has(r.id) && !!seen.add(r.id))
    .map((r) => fromRow(r as Row))
    .sort(newestFirst);
}

export const newestFirst = (a: Movement, b: Movement) => Date.parse(b.createdAt) - Date.parse(a.createdAt);

let queue: Promise<unknown> = Promise.resolve();
function serial<T>(job: () => Promise<T>): Promise<T> {
  const next = queue.then(job, job);
  queue = next.catch(() => {});
  return next;
}

async function readStock(productId: string) {
  const { data, error } = await supabase().from("products").select("stock").eq("id", productId).single();
  if (error) throw error;
  return (data as { stock: number | null }).stock;
}

// Records one movement and moves the stock (never below 0). A sale of a product whose stock is
// not followed (null) leaves it null; a delivery starts it at 0.
export function recordMovement(args: {
  storeId: string;
  productId: string;
  delta: number;
  source: Source;
  confidence: number | null;
  how: "barcode" | "ai";
  confirmed: boolean;
}): Promise<Movement> {
  return serial(async () => {
    const db = supabase();
    const before = await readStock(args.productId);
    const after = before == null && args.delta < 0 ? null : Math.max(0, (before ?? 0) + args.delta);
    const note = args.how === "barcode" ? "barcode" : args.confirmed ? "ai confirmed" : "ai";
    const { data, error } = await db
      .from("stock_movements")
      .insert({
        store_id: args.storeId,
        product_id: args.productId,
        delta: args.delta,
        source: args.source,
        confidence: args.confidence == null ? null : Math.round(args.confidence * 100) / 100,
        note,
      })
      .select(COLUMNS)
      .single();
    if (error || !data) throw error ?? new Error("insert failed");
    if (after !== before) {
      const { error: e } = await db.from("products").update({ stock: after }).eq("id", args.productId);
      if (e) {
        await db.from("stock_movements").delete().eq("id", (data as Row).id);
        throw e;
      }
    }
    return { ...fromRow(data as Row), how: args.how, before, after };
  });
}

// Undoes a movement: marks it reverted and gives the stock back (what this visit really changed
// when known, else the movement's delta), never below 0.
export function revertMovement(m: Movement): Promise<{ revertedAt: string; stock: number | null }> {
  return serial(async () => {
    const db = supabase();
    const revertedAt = new Date().toISOString();
    const { error } = await db.from("stock_movements").update({ reverted_at: revertedAt }).eq("id", m.id).is("reverted_at", null);
    if (error) throw error;
    const now = await readStock(m.productId);
    const change = m.before !== null || m.after !== null ? (m.after ?? 0) - (m.before ?? 0) : m.delta;
    let stock = now;
    if (now != null && change !== 0) {
      stock = Math.max(0, now - change);
      const { error: e } = await db.from("products").update({ stock }).eq("id", m.productId);
      if (e) throw e;
    }
    return { revertedAt, stock };
  });
}

// 1 minus undone over counted, on the latest movements; null before the first one.
export function accuracy(list: Movement[]) {
  const recent = list.slice(0, RECENT);
  if (!recent.length) return null;
  return 1 - recent.filter((m) => m.revertedAt).length / recent.length;
}

// A product the merchant corrected lately is asked about before it is counted, until two
// movements of it went through without being undone since that correction.
export function askFirst(list: Movement[], productId: string) {
  const recent = list.slice(0, RECENT).filter((m) => m.productId === productId);
  const lastUndo = recent.findIndex((m) => m.revertedAt);
  if (lastUndo < 0) return false;
  return recent.slice(0, lastUndo).filter((m) => !m.revertedAt).length < 2;
}
