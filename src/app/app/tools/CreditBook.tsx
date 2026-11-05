"use client";

// The credit book ("Carnet de crédit"): what customers owe the shop, installment by installment.
// The top shows what is owed, what is late and what comes in the next 7 days; each customer opens
// on their schedule, payments and a one-tap WhatsApp reminder. A credit is typed or said out loud.
// Pieces live in ./credit (data, schedule, voice, sheets).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/i18n";
import CustomerSheet from "./credit/CustomerSheet";
import { loadBook, saveRib, type Book } from "./credit/data";
import NewCredit from "./credit/NewCredit";
import { daysFrom, today } from "./credit/schedule";
import { Avatar, BackIcon, CreditStyles, dayLabel, MicIcon, money, Pill } from "./credit/ui";
import { useCreditVoice, type Draft } from "./credit/voice";
import { WORDS } from "./credit/words";
import type { ToolProps } from "./types";

type Sheet =
  | {
      kind: "new";
      v: number;
      form: number;
      draft?: Draft;
      said?: string;
      preset?: { name: string; phone: string };
    }
  | { kind: "customer"; id: string }
  | null;

export default function CreditBook({ store, onExit, onChanged }: ToolProps) {
  const { lang } = useT();
  const w = WORDS[lang];
  const currency = store.currency;
  const fmt = (v: number) => money(v, currency, lang);
  const [book, setBook] = useState<Book | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rib, setRib] = useState(store.rib ?? "");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [fresh, setFresh] = useState<string | null>(null);

  const load = useCallback(
    () =>
      loadBook(store.id).then(
        (b) => {
          setBook(b);
          setLoadError(null);
        },
        (e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)),
      ),
    [store.id],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const names = useMemo(() => (book?.customers ?? []).map((c) => c.name), [book]);
  const onDraft = useCallback(
    (draft: Draft, said: string) =>
      setSheet((s) => ({
        kind: "new",
        v: s?.kind === "new" ? s.v : Date.now(),
        form: Date.now(),
        draft,
        said,
      })),
    [],
  );
  const voice = useCreditVoice({ lang, names, w, onDraft });

  const openNew = (preset?: { name: string; phone: string }) => setSheet({ kind: "new", v: Date.now(), form: 0, preset });
  const dictate = () => {
    voice.start(); // in the tap, for iOS
    setSheet({ kind: "new", v: Date.now(), form: 0 });
  };
  const closeSheet = () => {
    voice.cancel();
    setSheet(null);
  };
  const changed = async () => {
    await load();
    onChanged();
  };

  const now = today();
  const customer = sheet?.kind === "customer" ? book?.customers.find((c) => c.id === sheet.id) : null;
  const empty = book && book.customers.length === 0;

  return (
    <div className="min-h-dvh bg-white text-ink">
      <CreditStyles />
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-white px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
        <button type="button" onClick={onExit} aria-label={w.back} className="flex h-10 w-10 items-center justify-center rounded-full text-ink hover:bg-soft">
          <BackIcon />
        </button>
        <h1 className="flex-1 text-lg font-semibold tracking-[-0.01em]">{w.title}</h1>
      </header>

      <main className="mx-auto max-w-lg px-4 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))]">
        {loadError && (
          <p className="mb-3 flex items-center gap-3 text-sm text-danger">
            <span className="flex-1">{w.error}</span>
            <button type="button" onClick={() => void load()} className="font-medium text-brand">
              {w.retry}
            </button>
          </p>
        )}

        {/* What the shop is owed */}
        <section className="grid grid-cols-3 gap-2">
          <Stat label={w.owed} value={book ? fmt(book.owed) : null} />
          <Stat label={w.late} value={book ? fmt(book.late) : null} danger={!!book?.late} />
          <Stat label={w.week} value={book ? fmt(book.week) : null} />
        </section>

        {!book && !loadError && (
          <ul className="mt-6 divide-y divide-line" aria-hidden>
            {[0, 1, 2].map((k) => (
              <li key={k} className="flex items-center gap-3 py-3">
                <span className="ui-skel h-9 w-9 rounded-full" />
                <span className="flex-1">
                  <span className="ui-skel block h-3.5 w-28" />
                  <span className="ui-skel mt-2 block h-3 w-40" />
                </span>
              </li>
            ))}
          </ul>
        )}

        {empty && (
          <div className="ui-card mt-6 p-4">
            <p className="text-sm text-ink-2">{w.empty}</p>
            <div className="mt-4 flex items-center gap-2">
              <button type="button" onClick={() => openNew()} className="ui-btn ui-btn-primary h-11 flex-1">
                {w.newCredit}
              </button>
              <MicButton onClick={dictate} label={w.dictate} />
            </div>
            <p className="mt-3 text-[13px] text-ink-3">
              {w.emptyTry} « {w.example} »
            </p>
          </div>
        )}

        {book && book.customers.length > 0 && (
          <section className="mt-6">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">{w.customers}</h2>
              <span className="text-[13px] text-ink-3 tabular-nums">{w.people(book.customers.filter((c) => c.balance > 0).length)}</span>
            </div>
            <ul className="mt-1 divide-y divide-line">
              {book.customers.map((c) => {
                const next = c.open[0];
                return (
                  <li key={c.id} className={fresh === c.id ? "line-in" : ""}>
                    <button
                      type="button"
                      onClick={() => setSheet({ kind: "customer", id: c.id })}
                      className={`flex w-full items-center gap-3 py-3 text-start ${c.tone === "done" ? "opacity-60" : ""}`}
                    >
                      <Avatar name={c.name} size={36} />
                      <span className="min-w-0 flex-1">
                        <span dir="auto" className="block truncate text-sm font-medium">
                          {c.name}
                        </span>
                        <span className={`block truncate text-[13px] tabular-nums ${c.tone === "late" ? "text-danger" : "text-ink-3"}`}>
                          {next ? `${dayLabel(next.due_on, lang)} · ${fmt(next.amount)} · ${w.when(daysFrom(now, next.due_on))}` : w.settled}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <span className="text-sm font-semibold tabular-nums">{fmt(Math.max(0, c.balance))}</span>
                        <Pill tone={c.tone} w={w} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </main>

      {book && !empty && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-white px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto flex max-w-lg items-center gap-2">
            <button type="button" onClick={() => openNew()} className="ui-btn ui-btn-primary h-11 flex-1">
              {w.newCredit}
            </button>
            <MicButton onClick={dictate} label={w.dictate} />
          </div>
        </div>
      )}

      {sheet?.kind === "new" && book && (
        <NewCredit
          key={sheet.v}
          formKey={sheet.form}
          storeId={store.id}
          currency={currency}
          lang={lang}
          w={w}
          customers={book.customers}
          defaultCount={book.defaultCount}
          draft={sheet.draft}
          said={sheet.said}
          preset={sheet.preset}
          voice={voice}
          onClose={closeSheet}
          onSaved={async (id) => {
            await changed();
            setFresh(id);
            setSheet({ kind: "customer", id });
          }}
        />
      )}

      {customer && (
        <CustomerSheet
          key={customer.id}
          c={customer}
          storeId={store.id}
          storeName={store.name}
          currency={currency}
          lang={lang}
          w={w}
          rib={rib}
          onRib={async (r) => {
            await saveRib(store.id, r);
            setRib(r.trim());
            onChanged();
          }}
          onClose={() => setSheet(null)}
          onChanged={changed}
          onNewFor={(name, phone) => openNew({ name, phone })}
        />
      )}
    </div>
  );
}

// One figure of the summary, like the Home tab's stats.
function Stat({ label, value, danger }: { label: string; value: string | null; danger?: boolean }) {
  return (
    <div className="ui-card p-3">
      {value === null ? (
        <span className="ui-skel block h-5 w-16" />
      ) : (
        <span className={`block text-base font-semibold tabular-nums ${danger ? "text-danger" : ""}`}>{value}</span>
      )}
      <span className="mt-0.5 block text-[13px] leading-snug text-ink-3">{label}</span>
    </div>
  );
}

// "Dicter": the round mic control, soft grey with a thin ink mic.
function MicButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-soft text-ink active:scale-95"
    >
      <MicIcon size={20} />
    </button>
  );
}
