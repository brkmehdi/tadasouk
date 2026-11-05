"use client";

// Small visual pieces of the credit book: amounts, status pills, initials, icons for the round
// controls, and the few motions that help (a row appearing, a field filled by voice).

import type { Lang } from "@/lib/lang";
import type { Tone } from "./schedule";
import { locale, type Words } from "./words";

export function money(v: number, currency: string, lang: Lang) {
  const n = new Intl.NumberFormat(locale(lang), {
    maximumFractionDigits: 2,
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
  }).format(v);
  return currency === "EUR" ? `${n} €` : `${n} DH`;
}

// "ven. 7 nov." from "2026-11-07".
export function dayLabel(iso: string, lang: Lang, long = false) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale(lang), {
    timeZone: "UTC",
    weekday: long ? "long" : "short",
    day: "numeric",
    month: long ? "long" : "short",
  });
}

// The tiny tinted pills of the sales list.
export const TONE: Record<Tone, string> = {
  late: "bg-danger/10 text-danger",
  soon: "bg-amber-100 text-amber-800",
  ok: "bg-ok/15 text-ok",
  done: "bg-soft text-ink-3",
};

export function Pill({ tone, w }: { tone: Tone; w: Words }) {
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${TONE[tone]}`}>{w.tone[tone]}</span>;
}

// Plain initials on the soft grey.
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-soft font-medium text-ink-2"
      style={{ width: size, height: size, fontSize: size >= 40 ? 14 : 13 }}
      aria-hidden
    >
      {initials || "?"}
    </span>
  );
}

const icon = (d: React.ReactNode, size = 20, stroke = 1.6) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={stroke}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    {d}
  </svg>
);
export const BackIcon = () => icon(<path d="M15 5l-7 7 7 7" />, 20, 1.8);
export const PhoneIcon = () => icon(<path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />, 16);
export const MicIcon = ({ size = 20 }: { size?: number }) =>
  icon(
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </>,
    size,
  );
export const CloseIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
    <path d="M1.5 1.5l7 7m0-7l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

// The round controls of the book's sheets: 32px, soft grey, thin ink icon.
export const ROUND = "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-soft text-ink";

// The book's few motions; kept here so the shared stylesheet stays untouched.
export function CreditStyles() {
  return (
    <style>{`
.cb-rise { animation: cb-rise .25s ease-out both; }
@keyframes cb-rise { from { opacity: 0; transform: translateY(6px); } }
.cb-filled { animation: cb-filled 1.4s ease-out both; }
@keyframes cb-filled { 0%, 30% { box-shadow: 0 0 0 1px rgb(50 151 211), 0 0 0 3px rgb(50 151 211 / .35); } }
.cb-paid { animation: cb-paid 1.2s ease-out both; }
@keyframes cb-paid { from { background: rgb(36 180 126 / .1); } }
@media (prefers-reduced-motion: reduce) {
  .cb-rise, .cb-filled, .cb-paid { animation: none; }
}
`}</style>
  );
}
