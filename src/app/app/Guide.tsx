"use client";

// First visits: four steps from an empty store to a product online. Each step ticks itself from
// what the store really holds (a product, a price, something online), so the guide follows the
// merchant whether they use the buttons or their voice. Hidden once done or dismissed.

import { useSyncExternalStore } from "react";
import type { CatalogProduct } from "@/lib/catalog/types";
import { useT, type Key } from "@/lib/i18n";

const HIDDEN = "smallstore.guide.hidden";
const listeners = new Set<() => void>();

function readHidden() {
  try {
    return localStorage.getItem(HIDDEN) === "1";
  } catch {
    return false;
  }
}

function setHidden(v: boolean) {
  try {
    if (v) localStorage.setItem(HIDDEN, "1");
    else localStorage.removeItem(HIDDEN);
  } catch {
    // private mode: the guide just shows again next time
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export default function Guide({ products, onRecord }: { products: CatalogProduct[]; onRecord: () => void }) {
  const { t } = useT();
  const hidden = useSyncExternalStore(subscribe, readHidden, () => false);

  const taken = products.length > 0;
  const steps: { key: Key; done: boolean }[] = [
    { key: "guide.step1", done: taken },
    { key: "guide.step2", done: taken },
    { key: "guide.step3", done: products.some((p) => p.price != null) },
    { key: "guide.step4", done: products.some((p) => p.status === "published") },
  ];
  const current = steps.findIndex((s) => !s.done);
  const allDone = current === -1;

  if (hidden) {
    return (
      <button type="button" onClick={() => setHidden(false)} className="mt-2 text-sm font-medium text-brand">
        {t("guide.show")}
      </button>
    );
  }

  return (
    <section className="ui-card mt-2 p-4">
      <h2 className="text-[15px] font-semibold">{allDone ? t("guide.done") : t("guide.title")}</h2>
      {!allDone && (
        <ol className="mt-3 flex flex-col gap-3">
          {steps.map((s, i) => (
            <li key={s.key} className={`flex gap-3 text-sm ${i === current ? "text-ink" : s.done ? "text-ink-3" : "text-ink-2"}`}>
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                  s.done ? "bg-ok text-white" : i === current ? "bg-brand text-white" : "bg-soft text-ink-3"
                }`}
                aria-hidden
              >
                {s.done ? "✓" : i + 1}
              </span>
              <span className={s.done ? "line-through decoration-ink-3/40" : ""}>{t(s.key)}</span>
            </li>
          ))}
        </ol>
      )}
      <div className="mt-4 flex items-center gap-3">
        {current === 0 || current === 1 ? (
          <button type="button" onClick={onRecord} className="ui-btn ui-btn-primary h-10 px-4">
            {t("guide.go")}
          </button>
        ) : null}
        <button type="button" onClick={() => setHidden(true)} className="ms-auto text-sm text-ink-3">
          {t("guide.hide")}
        </button>
      </div>
    </section>
  );
}
