// Dates and amounts of the credit book. Dates are "YYYY-MM-DD" days in Morocco's time zone,
// computed in UTC so a day never shifts. A schedule splits a total into installments of whole
// dirhams where it can; the total never changes and the last installment absorbs the rounding.

export const TZ = "Africa/Casablanca";
export const SOON_DAYS = 7; // "due soon" and "due this week"

export function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const toUtc = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));

export function addDays(iso: string, n: number) {
  return new Date(toUtc(iso) + n * 86_400_000).toISOString().slice(0, 10);
}

export function daysFrom(from: string, to: string) {
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

export const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(toUtc(s));

export type Planned = { due_on: string; amount: number };

export function buildSchedule(total: number, count: number, intervalDays: number, firstDue: string): Planned[] {
  const cents = Math.round(total * 100);
  const n = Math.max(1, Math.min(24, Math.floor(count)));
  if (!(cents > 0) || !isDay(firstDue)) return [];
  let each = Math.floor(cents / n / 100) * 100; // whole dirhams
  if (each === 0) each = Math.floor(cents / n);
  if (each === 0) return [];
  return Array.from({ length: n }, (_, i) => ({
    due_on: addDays(firstDue, i * intervalDays),
    amount: (i === n - 1 ? cents - each * (n - 1) : each) / 100,
  }));
}

export type Tone = "late" | "soon" | "ok" | "done";

// The state of one unpaid installment, or of a customer from their unpaid installments.
export function toneOf(due: string, now: string): Tone {
  const d = daysFrom(now, due);
  return d < 0 ? "late" : d < SOON_DAYS ? "soon" : "ok";
}
