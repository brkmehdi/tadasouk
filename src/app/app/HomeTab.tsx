"use client";

// Home: what the store holds at a glance, and the latest products.

import { formatPrice } from "@/app/capture/ProductCard";
import { coverOf, type CatalogProduct } from "@/lib/catalog/types";
import { useT } from "@/lib/i18n";
import type { AiCredit, Tab } from "./BackOffice";
import { ToolsGrid } from "./tools/Tools";
import type { ToolId } from "./tools/types";

type Props = {
  products: CatalogProduct[];
  orders: number;
  ai: AiCredit;
  currency: string;
  onTab: (t: Tab) => void;
  onTool: (id: ToolId) => void;
};

export default function HomeTab({ products, orders, ai, currency, onTab, onTool }: Props) {
  const { t } = useT();
  const drafts = products.filter((p) => p.status === "draft").length;
  const online = products.filter((p) => p.status === "published").length;
  const latest = products.slice(0, 8);

  return (
    <>
      {ai.pending ? (
        <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">{t("home.aiPending")}</p>
      ) : (
        <p className="mt-3 text-xs text-ink-3 tabular-nums">
          {t("home.aiCredit")} {ai.balance.toFixed(2)} $
        </p>
      )}
      <section className="mt-4 grid grid-cols-3 gap-2">
        <Stat label={t("home.drafts")} value={drafts} onClick={() => onTab("products")} />
        <Stat label={t("home.online")} value={online} onClick={() => onTab("products")} />
        <Stat label={t("home.sales")} value={orders} onClick={() => onTab("sales")} />
      </section>

      <ToolsGrid onOpen={onTool} />

      {latest.length > 0 && (
        <section className="mt-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium">{t("home.latest")}</h2>
            <button type="button" onClick={() => onTab("products")} className="text-sm font-medium text-brand">
              {t("home.seeAll")}
            </button>
          </div>
          <div className="no-scrollbar -mx-5 mt-3 flex gap-3 overflow-x-auto px-5 pb-1">
            {latest.map((p) => {
              const cover = coverOf(p);
              return (
                <button key={p.id} type="button" onClick={() => onTab("products")} className="w-28 shrink-0 text-start">
                  <span className="relative block aspect-square overflow-hidden rounded-md bg-white ring-1 ring-line">
                    {cover && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cover} alt="" className="h-full w-full object-contain" />
                    )}
                    {p.status === "published" && <span className="absolute end-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-ok ring-2 ring-white" />}
                  </span>
                  <span className="mt-1.5 block truncate text-xs font-medium">{p.name || t("products.noName")}</span>
                  <span className="block text-xs text-ink-3 tabular-nums">
                    {p.price != null ? formatPrice(p.price, currency) : t("products.noPrice")}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}

function Stat({ label, value, onClick }: { label: string; value: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="ui-card p-3 text-start">
      <span className="block text-[22px] font-semibold tabular-nums tracking-tight">{value}</span>
      <span className="block text-xs text-ink-3">{label}</span>
    </button>
  );
}
