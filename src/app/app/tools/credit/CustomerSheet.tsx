"use client";

// One customer of the credit book: what is left to pay, a one-tap WhatsApp reminder (amount, due
// date and the store's RIB), the installment schedule where each one is collected in cash or by
// transfer, and the history of credits and payments.

import { useState } from "react";
import type { Lang } from "@/lib/lang";
import { displayPhone, phoneDigits } from "@/lib/phone";
import { markPaid, setReminded, type Customer, type Installment } from "./data";
import { daysFrom, today, toneOf } from "./schedule";
import { Avatar, CloseIcon, dayLabel, money, PhoneIcon, Pill, ROUND } from "./ui";
import { locale, type Words } from "./words";

type Props = {
  c: Customer;
  storeId: string;
  storeName: string;
  currency: string;
  lang: Lang;
  w: Words;
  rib: string;
  onRib: (rib: string) => Promise<void>;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onNewFor: (name: string, phone: string) => void;
};

export default function CustomerSheet({ c, storeId, storeName, currency, lang, w, rib, onRib, onClose, onChanged, onNewFor }: Props) {
  const now = today();
  const fmt = (v: number) => money(v, currency, lang);
  const [collecting, setCollecting] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [justPaid, setJustPaid] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [ribDraft, setRibDraft] = useState(rib);
  const [editRib, setEditRib] = useState(!rib);
  const [savingRib, setSavingRib] = useState(false);
  const [sentAt, setSentAt] = useState<string | null>(null);

  // The reminder is about the late installments, or else the next one.
  const late = c.open.filter((i) => i.due_on < now);
  const target = late.length ? late : c.open.slice(0, 1);
  const owed = target.reduce((s, i) => s + i.amount, 0);
  const message = target.length
    ? [(late.length ? w.msgLate : w.msgDue)(c.name, storeName, fmt(owed), dayLabel(target[0].due_on, lang, true)), rib ? w.msgRib(rib) : "", w.msgThanks]
        .filter(Boolean)
        .join("\n")
    : "";
  const wa = `https://wa.me/${phoneDigits(c.phone)}?text=${encodeURIComponent(message)}`;
  const reminded = sentAt ?? c.reminded;

  const remind = () => {
    setSentAt(new Date().toISOString());
    void setReminded(target.map((i) => i.id)).then(onChanged);
  };

  const pay = async (i: Installment, idx: number, n: number, method: "cash" | "transfer") => {
    setBusy(i.id);
    setError(null);
    try {
      const done = await markPaid(storeId, c.id, i, method, `${w.inst(idx, n)} · ${method === "cash" ? w.cash : w.transfer}`);
      if (done) setJustPaid((s) => new Set(s).add(i.id));
      setCollecting(null);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : w.error);
    } finally {
      setBusy(null);
    }
  };

  const saveRib = async () => {
    setSavingRib(true);
    try {
      await onRib(ribDraft);
      setEditRib(!ribDraft.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : w.error);
    } finally {
      setSavingRib(false);
    }
  };

  const when = (iso: string) =>
    new Date(iso).toLocaleString(locale(lang), {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Africa/Casablanca",
    });

  return (
    <div className="fixed inset-0 z-20" role="dialog" aria-modal="true" aria-label={c.name}>
      <div className="ui-scrim" onClick={onClose} />
      <div className="ui-sheet-up absolute inset-x-0 bottom-0 mx-auto max-h-[94dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white text-ink shadow-[0_-12px_40px_rgba(0,0,0,.25)]">
        <div className="sticky top-0 z-10 flex items-center gap-3 bg-white px-5 pt-4 pb-3">
          <Avatar name={c.name} size={40} />
          <div className="min-w-0 flex-1">
            <p dir="auto" className="truncate text-base font-medium">
              {c.name}
            </p>
            <p className="text-[13px] text-ink-3 tabular-nums">{displayPhone(phoneDigits(c.phone))}</p>
          </div>
          <a href={`tel:+${phoneDigits(c.phone)}`} aria-label={w.call} className={ROUND}>
            <PhoneIcon />
          </a>
          <button type="button" onClick={onClose} aria-label={w.back} className={ROUND}>
            <CloseIcon />
          </button>
        </div>

        <div className="px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div className="flex items-end justify-between gap-3 border-b border-line pb-4">
            <div>
              <p className="text-[13px] text-ink-3">{w.left}</p>
              <p className="text-[28px] leading-tight font-semibold tracking-tight tabular-nums">{fmt(Math.max(0, c.balance))}</p>
            </div>
            <span className="mb-2">
              <Pill tone={c.tone} w={w} />
            </span>
          </div>

          {error && <p className="mt-3 text-sm text-danger">{error}</p>}

          {target.length > 0 ? (
            <section className="mt-4">
              {editRib ? (
                <div className="mb-4">
                  <label className="ui-label" htmlFor="cb-rib">
                    {w.ribLabel}
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="cb-rib"
                      className="ui-input flex-1 tabular-nums"
                      value={ribDraft}
                      onChange={(e) => setRibDraft(e.target.value.slice(0, 80))}
                      placeholder={w.ribPlaceholder}
                      inputMode="numeric"
                    />
                    <button
                      type="button"
                      onClick={() => void saveRib()}
                      disabled={savingRib || ribDraft.trim() === rib}
                      className="ui-btn ui-btn-secondary h-11"
                    >
                      {w.ribSave}
                    </button>
                  </div>
                </div>
              ) : null}

              {/* What the customer will receive. */}
              <p dir="auto" className="rounded-2xl bg-soft px-3.5 py-2.5 text-[13px] leading-snug whitespace-pre-line text-ink-2">
                {message}
              </p>
              <a href={wa} target="_blank" rel="noopener" onClick={remind} className="ui-btn ui-btn-primary mt-3 h-11 w-full">
                {w.remind}
              </a>
              <div className="mt-1.5 flex items-center justify-between gap-2 text-[13px] text-ink-3">
                <span>{reminded ? `${w.reminded} · ${when(reminded)}` : ""}</span>
                {!editRib && (
                  <button type="button" onClick={() => setEditRib(true)} className="font-medium text-brand">
                    {w.ribEdit}
                  </button>
                )}
              </div>
            </section>
          ) : (
            <p className="mt-4 text-sm font-medium text-ok">{w.settled}</p>
          )}

          {c.plans.length > 0 && (
            <section className="mt-6">
              <h3 className="text-sm font-semibold">{w.schedule}</h3>
              {c.plans.map((p) => {
                const paidCount = p.installments.filter((i) => i.paid_at).length;
                return (
                  <div key={p.id} className="ui-card mt-2 overflow-hidden">
                    <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
                      <p dir="auto" className="min-w-0 flex-1 truncate text-[13px] font-medium">
                        {p.note || w.saleEntry}{" "}
                        <span className="font-normal text-ink-3">· {p.count > 1 ? `${w.times(p.count)}, ${w.every(p.interval_days)}` : w.times(1)}</span>
                      </p>
                      <span className="text-[13px] text-ink-3 tabular-nums">{w.paidOf(paidCount, p.installments.length)}</span>
                    </div>
                    <ol className="divide-y divide-line">
                      {p.installments.map((i, k) => {
                        const tone = i.paid_at ? "done" : toneOf(i.due_on, now);
                        const d = daysFrom(now, i.due_on);
                        const fresh = justPaid.has(i.id);
                        return (
                          <li key={i.id} className={fresh ? "cb-paid" : ""}>
                            <div className="flex items-center gap-3 px-3.5 py-3">
                              <span className="w-4 shrink-0 text-center text-[13px] text-ink-3 tabular-nums">{k + 1}</span>
                              <span className="min-w-0 flex-1">
                                <span className={`block text-sm capitalize ${i.paid_at ? "text-ink-3" : "font-medium"}`}>{dayLabel(i.due_on, lang)}</span>
                                <span className={`block text-[13px] ${i.paid_at ? "text-ok" : tone === "late" ? "text-danger" : "text-ink-3"}`}>
                                  {i.paid_at
                                    ? `${w.paid}${i.method ? ` · ${i.method === "transfer" ? w.transfer : w.cash}` : ""} · ${when(i.paid_at)}`
                                    : tone === "late"
                                      ? `${w.tone.late} · ${w.when(d)}`
                                      : w.when(d)}
                                </span>
                              </span>
                              <span className={`text-sm font-semibold tabular-nums ${i.paid_at ? "text-ink-3 line-through" : ""}`}>{fmt(i.amount)}</span>
                              {!i.paid_at && collecting !== i.id && (
                                <button type="button" onClick={() => setCollecting(i.id)} className="ui-btn ui-btn-secondary h-8 px-2.5 text-[13px]">
                                  {w.collect}
                                </button>
                              )}
                            </div>
                            {!i.paid_at && collecting === i.id && (
                              <div className="cb-rise grid grid-cols-[1fr_1fr_auto] gap-2 px-3.5 pb-3">
                                <button
                                  type="button"
                                  disabled={busy === i.id}
                                  onClick={() => void pay(i, k + 1, p.installments.length, "cash")}
                                  className="ui-btn ui-btn-secondary h-10"
                                >
                                  {w.cash}
                                </button>
                                <button
                                  type="button"
                                  disabled={busy === i.id}
                                  onClick={() => void pay(i, k + 1, p.installments.length, "transfer")}
                                  className="ui-btn ui-btn-secondary h-10"
                                >
                                  {w.transfer}
                                </button>
                                <button type="button" onClick={() => setCollecting(null)} aria-label={w.cancel} className="ui-btn ui-btn-soft h-10 w-10 p-0">
                                  <CloseIcon />
                                </button>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                );
              })}
            </section>
          )}

          {c.entries.length > 0 && (
            <section className="mt-6">
              <h3 className="text-sm font-semibold">{w.history}</h3>
              <ol className="mt-1 divide-y divide-line">
                {c.entries.map((e) => {
                  const sale = e.amount > 0;
                  return (
                    <li key={e.id} className="flex items-start gap-3 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{sale ? w.saleEntry : w.payEntry}</span>
                        {e.note && (
                          <span dir="auto" className="block truncate text-[13px] text-ink-2">
                            {e.note}
                          </span>
                        )}
                        <span className="block text-[11px] text-ink-3">{when(e.created_at)}</span>
                      </span>
                      <span className={`text-sm font-semibold tabular-nums ${sale ? "" : "text-ok"}`}>
                        {sale ? "+" : ""}
                        {fmt(Math.abs(e.amount))}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          <button type="button" onClick={() => onNewFor(c.name, c.phone)} className="ui-btn ui-btn-secondary mt-5 h-11 w-full">
            {w.moreCredit} {c.name}
          </button>
        </div>
      </div>
    </div>
  );
}
