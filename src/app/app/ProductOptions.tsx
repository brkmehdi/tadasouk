"use client";

// A product's colours and sizes, and which combinations are sold out. Every change is saved at
// once (row level security keeps it to the merchant's own products); the store shows colours
// as discs (with the photos linked to each), sizes as boxes, sold-out ones greyed out.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { colorsOf, soldoutKey, type CatalogProduct } from "@/lib/catalog/types";
import { useT } from "@/lib/i18n";
import { supabase } from "@/lib/supabase/browser";

const PRESETS: [string, string[]][] = [
  ["XS–XXL", ["XS", "S", "M", "L", "XL", "XXL"]],
  ["36–46", ["36", "38", "40", "42", "44", "46"]],
  ["S–XL", ["S", "M", "L", "XL"]],
];

export function ProductOptions({ storeId, p }: { storeId: string; p: CatalogProduct }) {
  const { t } = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [colorName, setColorName] = useState("");
  const [hex, setHex] = useState("#222222");
  const [size, setSize] = useState("");
  const colors = colorsOf(p);
  const sizes = p.sizes ?? [];
  const soldout = p.soldout ?? [];

  const run = async (fn: () => PromiseLike<{ error: unknown }>) => {
    setBusy(true);
    setError(false);
    const { error } = await fn();
    setBusy(false);
    if (error) setError(true);
    else router.refresh();
    return !error;
  };
  const setSizes = (next: string[]) => run(() => supabase().from("products").update({ sizes: next }).eq("id", p.id));
  const toggleSoldout = (key: string) =>
    run(() =>
      supabase()
        .from("products")
        .update({ soldout: soldout.includes(key) ? soldout.filter((k) => k !== key) : [...soldout, key] })
        .eq("id", p.id),
    );
  const addColor = async () => {
    const name = colorName.trim();
    if (!name) return;
    const done = await run(() => supabase().from("product_colors").insert({ product_id: p.id, store_id: storeId, name, hex, position: colors.length }));
    if (done) setColorName("");
  };
  const addSize = async () => {
    const s = size.trim().toUpperCase();
    if (!s || sizes.includes(s)) return;
    if (await setSizes([...sizes, s])) setSize("");
  };
  const rows: (string | null)[] = colors.length ? colors.map((c) => c.id) : [null];

  return (
    <div className={`mt-5 flex flex-col gap-5 ${busy ? "opacity-70" : ""}`}>
      <section>
        <p className="ui-label">{t("products.colors")}</p>
        <div className="flex flex-wrap gap-2">
          {colors.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1.5 rounded-full bg-soft py-1 ps-1 pe-2 text-[13px]">
              <span className="h-5 w-5 rounded-full ring-1 ring-black/15" style={{ background: c.hex }} />
              {c.name}
              <button
                type="button"
                aria-label={`${t("settings.delete")} ${c.name}`}
                onClick={() => void run(() => supabase().from("product_colors").delete().eq("id", c.id))}
                className="ms-0.5 text-ink-3"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input type="color" value={hex} onChange={(e) => setHex(e.target.value)} aria-label={t("products.colors")} className="h-10 w-10 shrink-0 cursor-pointer rounded-md bg-white p-1 shadow-[0_0_0_1px_var(--line)]" />
          <input className="ui-input h-10 text-[14px]" placeholder={t("products.colorName")} value={colorName} onChange={(e) => setColorName(e.target.value)} maxLength={40} />
          <button type="button" onClick={() => void addColor()} disabled={!colorName.trim() || busy} className="ui-btn ui-btn-secondary h-10 px-3 text-[13px]">
            {t("products.add")}
          </button>
        </div>
        {colors.length > 0 && <p className="mt-1.5 text-xs text-ink-3">{t("products.colorsHint")}</p>}
      </section>

      <section>
        <p className="ui-label">{t("products.sizes")}</p>
        <div className="flex flex-wrap gap-2">
          {sizes.map((s) => (
            <span key={s} className="inline-flex items-center gap-1 rounded-md bg-soft px-2 py-1 text-[13px] font-medium">
              {s}
              <button type="button" aria-label={`${t("settings.delete")} ${s}`} onClick={() => void setSizes(sizes.filter((x) => x !== s))} className="text-ink-3">
                ✕
              </button>
            </span>
          ))}
          {sizes.length === 0 &&
            PRESETS.map(([label, list]) => (
              <button key={label} type="button" onClick={() => void setSizes(list)} className="rounded-md bg-soft px-2 py-1 text-[13px] font-medium text-ink-2 hover:bg-black/10">
                + {label}
              </button>
            ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            className="ui-input h-10 text-[14px]"
            placeholder={t("products.sizeName")}
            value={size}
            onChange={(e) => setSize(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void addSize();
              }
            }}
            maxLength={20}
          />
          <button type="button" onClick={() => void addSize()} disabled={!size.trim() || busy} className="ui-btn ui-btn-secondary h-10 px-3 text-[13px]">
            {t("products.add")}
          </button>
        </div>
        {sizes.length === 0 && <p className="mt-1.5 text-xs text-ink-3">{t("products.sizesHint")}</p>}
      </section>

      {sizes.length > 0 && (
        <section>
          <p className="ui-label">{t("products.soldout")}</p>
          <div className="overflow-x-auto">
            <table className="text-[12px]">
              <tbody>
                {rows.map((cid) => {
                  const c = colors.find((x) => x.id === cid);
                  return (
                    <tr key={cid ?? "one"}>
                      {c && (
                        <td className="pe-2 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="h-3 w-3 rounded-full ring-1 ring-black/15" style={{ background: c.hex }} />
                            {c.name}
                          </span>
                        </td>
                      )}
                      {sizes.map((s) => {
                        const key = soldoutKey(cid, s);
                        const out = soldout.includes(key);
                        return (
                          <td key={s} className="p-0.5">
                            <button
                              type="button"
                              aria-pressed={out}
                              onClick={() => void toggleSoldout(key)}
                              className={`h-8 min-w-10 rounded px-2 font-medium ${out ? "bg-danger/10 text-danger line-through" : "bg-soft text-ink-2"}`}
                            >
                              {s}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-1.5 text-xs text-ink-3">{t("products.soldoutHint")}</p>
        </section>
      )}
      {error && <p className="text-sm text-danger">{t("common.error")}</p>}
    </div>
  );
}
