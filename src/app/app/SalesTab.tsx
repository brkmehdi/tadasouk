"use client";

// Sales: the counter sale (scan or tap products, WhatsApp receipt), and the orders of the
// online store once the storefront takes them.

import type { CatalogProduct } from "@/lib/catalog/types";
import { useT } from "@/lib/i18n";

type Props = { orders: number; products: CatalogProduct[]; onCounterSale: () => void };

export default function SalesTab({ orders, products, onCounterSale }: Props) {
  const { t } = useT();
  return (
    <section className="mt-2">
      <h1 className="text-lg font-semibold tracking-[-0.01em]">{t("sales.title")}</h1>

      <button
        type="button"
        onClick={onCounterSale}
        disabled={products.length === 0}
        className="ui-card mt-3 flex w-full items-center gap-3 p-4 text-start disabled:opacity-50"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand" aria-hidden>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M4 6v12M8 6v12M11 6v12M15 6v12M18 6v12M20 6v12" />
          </svg>
        </span>
        <span>
          <span className="block text-sm font-medium">{t("sales.counter")}</span>
          <span className="block text-xs text-ink-3">{t("sales.counterHint")}</span>
        </span>
      </button>

      {orders === 0 && <p className="mt-6 text-sm text-ink-3">{t("sales.empty")}</p>}
    </section>
  );
}
