"use client";

// "New credit": who, how much, what they took, and how they will pay. The schedule shows before
// saving; the total never changes and the last installment absorbs the rounding. The form can be
// filled by voice: the panel on top listens, and the draft it returns lands in the fields.

import { useState } from "react";
import type { Lang } from "@/lib/lang";
import { displayPhone, phoneDigits } from "@/lib/phone";
import { saveCredit, type Customer } from "./data";
import { addDays, buildSchedule, isDay, today } from "./schedule";
import { CloseIcon, dayLabel, MicIcon, money, ROUND } from "./ui";
import type { CreditVoice, Draft } from "./voice";
import type { Words } from "./words";

const INTERVALS = [7, 14, 30];
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// An existing customer the spoken or typed name points to: the same name, or the only one it starts.
export function matchCustomer(name: string, customers: Customer[]) {
  const n = fold(name);
  if (!n) return null;
  const same = customers.find((c) => fold(c.name) === n);
  if (same) return same;
  const starts = customers.filter((c) => fold(c.name).startsWith(n) || n.startsWith(fold(c.name).split(" ")[0] + " "));
  return starts.length === 1 ? starts[0] : null;
}

type Props = {
  storeId: string;
  currency: string;
  lang: Lang;
  w: Words;
  customers: Customer[];
  defaultCount: number;
  draft?: Draft;
  said?: string;
  preset?: { name: string; phone: string };
  voice: CreditVoice;
  onClose: () => void;
  onSaved: (customerId: string) => void;
};

// The sheet stays up while a spoken draft refills the form (a new formKey remounts the form only).
export default function NewCredit({ formKey, ...props }: Props & { formKey: number }) {
  return (
    <div className="fixed inset-0 z-20" role="dialog" aria-modal="true" aria-label={props.w.newCredit}>
      <div className="ui-scrim" onClick={props.onClose} />
      <div className="ui-sheet-up absolute inset-x-0 bottom-0 mx-auto flex max-h-[94dvh] w-full max-w-lg flex-col rounded-t-2xl bg-white text-ink shadow-[0_-12px_40px_rgba(0,0,0,.25)]">
        <Form key={formKey} {...props} />
      </div>
    </div>
  );
}

function Form({ storeId, currency, lang, w, customers, defaultCount, draft, said, preset, voice, onClose, onSaved }: Props) {
  const now = today();
  const known = draft && !draft.phone ? matchCustomer(draft.customer_name, customers) : null;
  const firstInterval = draft?.interval_days || 30;
  const [name, setName] = useState(known?.name ?? draft?.customer_name ?? preset?.name ?? "");
  const [phone, setPhone] = useState(draft?.phone || (known ? displayPhone(known.phone) : preset ? displayPhone(preset.phone) : ""));
  const [amount, setAmount] = useState(draft?.amount ? String(draft.amount) : "");
  const [note, setNote] = useState(draft?.note ?? "");
  const [count, setCount] = useState(draft?.installments || (draft?.first_due ? 1 : defaultCount));
  const [interval, setIntervalDays] = useState(firstInterval);
  const [first, setFirst] = useState(draft?.first_due && draft.first_due >= now ? draft.first_due : addDays(now, firstInterval));
  const [firstTouched, setFirstTouched] = useState(!!draft?.first_due);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [typed, setTyped] = useState("");

  const total = Number(amount.replace(",", ".").replace(/\s/g, ""));
  const schedule = buildSchedule(total, count, interval, first);
  const filled = (v: unknown) => (draft && v ? "cb-filled" : "");
  const suggestions =
    name.trim() && !customers.some((c) => phoneDigits(c.phone) === phoneDigits(phone))
      ? customers.filter((c) => fold(c.name).includes(fold(name))).slice(0, 3)
      : [];

  const pickInterval = (d: number) => {
    setIntervalDays(d);
    if (!firstTouched) setFirst(addDays(now, d));
  };

  const save = async () => {
    setError(null);
    if (!name.trim()) return setError(w.needName);
    const digits = phoneDigits(phone);
    if (digits.length < 9 || digits.length > 15) return setError(w.needPhone);
    if (!(total > 0) || !schedule.length) return setError(w.needAmount);
    setSaving(true);
    try {
      const id = await saveCredit(storeId, {
        name,
        phone,
        amount: Math.round(total * 100) / 100,
        note,
        intervalDays: interval,
        schedule,
      });
      setDone(true);
      setTimeout(() => onSaved(id), 900);
    } catch (e) {
      setError(e instanceof Error ? e.message : w.error);
      setSaving(false);
    }
  };

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 px-5 pt-4 pb-3">
        <p className="flex-1 truncate text-base font-medium">{w.newCredit}</p>
        {voice.phase === "idle" && !done && (
          <button type="button" onClick={voice.start} aria-label={w.dictate} title={w.dictate} className={ROUND}>
            <MicIcon size={16} />
          </button>
        )}
        <button type="button" onClick={onClose} aria-label={w.cancel} className={ROUND}>
          <CloseIcon />
        </button>
      </div>

      {done ? (
        <div className="cb-rise px-5 pt-6 pb-14 text-center">
          <p className="text-base font-medium">{w.saved}</p>
          <p dir="auto" className="mt-1 text-[13px] text-ink-3 tabular-nums">
            {name} · {money(total, currency, lang)} · {w.times(schedule.length)}
          </p>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
            <VoicePanel voice={voice} w={w} typed={typed} setTyped={setTyped} />
            {said && voice.phase === "idle" && (
              <div className="mb-4 rounded-2xl bg-soft px-3.5 py-2.5">
                <p dir="auto" className="text-[13px] text-ink-2">
                  « {said} »
                </p>
                <p className="mt-0.5 text-[13px] text-ink-3">{w.fromVoice}</p>
              </div>
            )}

            <p className="ui-label">{w.who}</p>
            <div className="flex flex-col gap-2">
              <input
                className={`ui-input ${filled(draft?.customer_name)}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={w.name}
                aria-label={w.name}
                autoComplete="off"
                dir="auto"
              />
              {suggestions.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setName(c.name);
                        setPhone(displayPhone(c.phone));
                      }}
                      className="rounded-md bg-soft px-2.5 py-1 text-[13px]"
                    >
                      <span dir="auto">{c.name}</span>
                      <span className="text-ink-3"> · {w.known}</span>
                    </button>
                  ))}
                </div>
              )}
              <input
                className={`ui-input tabular-nums ${filled(draft?.phone || known)}`}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={w.phonePlaceholder}
                aria-label={w.phone}
                type="tel"
                inputMode="tel"
                autoComplete="off"
              />
            </div>

            <div className="mt-4 grid grid-cols-[1fr_1.4fr] gap-2">
              <label>
                <span className="ui-label">{w.amount}</span>
                <span className="relative block">
                  <input
                    className={`ui-input pe-10 font-semibold tabular-nums ${filled(draft?.amount)}`}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    inputMode="decimal"
                    placeholder="0"
                  />
                  <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-sm text-ink-3">{currency === "EUR" ? "€" : "DH"}</span>
                </span>
              </label>
              <label>
                <span className="ui-label">{w.what}</span>
                <input
                  className={`ui-input ${filled(draft?.note)}`}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={w.whatPlaceholder}
                  dir="auto"
                />
              </label>
            </div>

            <p className="ui-label mt-4">{w.how}</p>
            <div className="ui-card p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-ink-2">{w.count}</span>
                <span className={`flex items-center gap-1 rounded-md ${filled(draft?.installments)}`}>
                  <button
                    type="button"
                    onClick={() => setCount((c) => Math.max(1, c - 1))}
                    disabled={count <= 1}
                    className="ui-btn ui-btn-soft h-8 w-8 p-0"
                    aria-label="−"
                  >
                    −
                  </button>
                  <span className="w-8 text-center text-base font-semibold tabular-nums">{count}</span>
                  <button
                    type="button"
                    onClick={() => setCount((c) => Math.min(12, c + 1))}
                    disabled={count >= 12}
                    className="ui-btn ui-btn-soft h-8 w-8 p-0"
                    aria-label="+"
                  >
                    +
                  </button>
                </span>
              </div>
              {count > 1 && (
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="text-sm text-ink-2">{w.interval}</span>
                  <span className="flex rounded-md bg-soft p-0.5 text-[13px] font-medium">
                    {[...new Set([...INTERVALS, interval])].map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => pickInterval(d)}
                        aria-pressed={interval === d}
                        className={`rounded px-2.5 py-1 ${interval === d ? "bg-white text-ink shadow-sm" : "text-ink-3"}`}
                      >
                        {d === 7 ? w.weekly : d === 14 ? w.biweekly : d === 30 ? w.monthly : `${d} ${lang === "fr" ? "j" : "d"}`}
                      </button>
                    ))}
                  </span>
                </div>
              )}
              <label className="mt-3 flex items-center justify-between gap-3">
                <span className="text-sm text-ink-2">{count > 1 ? w.firstDue : w.oneDue}</span>
                <input
                  type="date"
                  className={`ui-input w-[11.5rem] ${filled(draft?.first_due)}`}
                  value={first}
                  min={now}
                  onChange={(e) => {
                    if (isDay(e.target.value)) {
                      setFirst(e.target.value);
                      setFirstTouched(true);
                    }
                  }}
                />
              </label>
            </div>

            {schedule.length > 0 && (
              <div className="mt-4">
                <p className="ui-label">{w.preview}</p>
                <ol className="ui-card divide-y divide-line">
                  {schedule.map((s, i) => (
                    <li key={`${i}-${s.due_on}-${s.amount}`} className="flex items-center gap-3 px-3.5 py-2.5 text-sm">
                      <span className="w-4 shrink-0 text-center text-[13px] text-ink-3 tabular-nums">{i + 1}</span>
                      <span className="flex-1 capitalize">{dayLabel(s.due_on, lang)}</span>
                      <span className="font-semibold tabular-nums">{money(s.amount, currency, lang)}</span>
                    </li>
                  ))}
                  <li className="flex items-baseline justify-between px-3.5 py-2.5">
                    <span className="text-[13px] text-ink-3">{w.total}</span>
                    <span className="text-base font-semibold tabular-nums">{money(Math.round(total * 100) / 100, currency, lang)}</span>
                  </li>
                </ol>
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-line px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {error && <p className="mb-2 text-sm text-danger">{error}</p>}
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || voice.phase !== "idle"}
              className="ui-btn ui-btn-primary h-11 w-full text-base"
            >
              {w.save}
              {total > 0 && <span className="font-normal opacity-80 tabular-nums">· {money(Math.round(total * 100) / 100, currency, lang)}</span>}
            </button>
          </div>
        </>
      )}
    </>
  );
}

// The listening state on top of the form: the mic grows with the voice, what was heard so far
// shows under it, then a placeholder while the AI prepares the draft. Without a microphone, a
// sentence can be typed.
function VoicePanel({ voice, w, typed, setTyped }: { voice: CreditVoice; w: Words; typed: string; setTyped: (s: string) => void }) {
  if (voice.phase === "listening")
    return (
      <div className="ui-card mb-4 flex flex-col items-center p-4 text-center">
        <span
          className="flex h-12 w-12 items-center justify-center rounded-full bg-soft text-ink transition-transform duration-100 motion-reduce:transition-none"
          style={{ transform: `scale(${1 + voice.level * 0.25})` }}
          aria-hidden
        >
          <MicIcon size={22} />
        </span>
        <p className="mt-3 text-base font-medium">{w.listening}</p>
        <p dir="auto" className={`mt-1 min-h-[2.5rem] text-sm ${voice.heard ? "text-ink" : "text-ink-3"}`}>
          {voice.heard ? `« ${voice.heard} »` : w.listenHint}
        </p>
        <div className="mt-3 grid w-full grid-cols-2 gap-2">
          <button type="button" onClick={voice.cancel} className="ui-btn ui-btn-soft h-11">
            {w.cancel}
          </button>
          <button type="button" onClick={() => void voice.finish()} className="ui-btn ui-btn-secondary h-11 font-semibold text-ink">
            {w.done}
          </button>
        </div>
      </div>
    );
  if (voice.phase === "thinking")
    return (
      <div className="ui-card mb-4 p-4" role="status">
        <p className="text-sm font-medium">{w.thinking}</p>
        {voice.heard && (
          <p dir="auto" className="mt-1 text-[13px] text-ink-2">
            « {voice.heard} »
          </p>
        )}
        <div className="mt-3 flex flex-col gap-2" aria-hidden>
          <span className="ui-skel block h-3 w-3/4" />
          <span className="ui-skel block h-3 w-1/2" />
        </div>
      </div>
    );
  if (!voice.error) return null;
  return (
    <div className="mb-4">
      <p className="text-sm text-danger">{voice.error}</p>
      {voice.noMic && (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.trim()) void voice.parse(typed.trim());
          }}
        >
          <input
            className="ui-input flex-1"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={w.example}
            aria-label={w.typeInstead}
            dir="auto"
          />
          <button type="submit" disabled={!typed.trim()} className="ui-btn ui-btn-secondary h-11">
            {w.send}
          </button>
        </form>
      )}
    </div>
  );
}
