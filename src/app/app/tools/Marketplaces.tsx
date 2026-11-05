"use client";

// Marketplaces: the store's products go to Facebook and Instagram Shop and Google Shopping
// through one product feed (/{slug}/feed.xml). Marketplaces never see the whole stock, only the
// stock minus a safety margin the merchant sets here (stores.marketplace_margin), so a miscount
// never sells the same item twice. Jumia and Avito are shown as coming, not connected.

import { useEffect, useMemo, useRef, useState } from "react";
import { coverOf } from "@/lib/catalog/types";
import { useT } from "@/lib/i18n";
import { supabase } from "@/lib/supabase/browser";
import { marketplaceQty, storeFiles } from "@/lib/visibility";
import type { ToolProps } from "./types";
import { Header } from "./Visibility";

type Channel = { id: string; name: string; tag: [string, string]; how?: [string, string]; soon?: boolean; logos: string[] };

const CHANNELS: Channel[] = [
  {
    id: "meta",
    name: "Facebook & Instagram Shop",
    tag: ["Catalogue Meta", "Meta catalogue"],
    how: [
      "Dans Commerce Manager, ouvrez Catalogue, puis Sources de données, ajoutez un flux de données et collez ce lien.",
      "In Commerce Manager, open Catalog, then Data sources, add a data feed and paste this link.",
    ],
    logos: ["facebook.svg", "instagram.svg"],
  },
  {
    id: "google",
    name: "Google Shopping",
    tag: ["Merchant Center", "Merchant Center"],
    how: [
      "Dans Google Merchant Center, ajoutez des produits depuis un fichier, choisissez « lien vers un fichier » et collez ce lien.",
      "In Google Merchant Center, add products from a file, pick \"file from a link\" and paste this link.",
    ],
    logos: ["google.svg"],
  },
  { id: "jumia", name: "Jumia", tag: ["Marketplace en ligne", "Online marketplace"], soon: true, logos: ["jumia.png"] },
  { id: "avito", name: "Avito", tag: ["Petites annonces", "Classifieds"], soon: true, logos: ["avito.svg"] },
];

const BRAND_NAME: Record<string, string> = {
  "facebook.svg": "Facebook",
  "instagram.svg": "Instagram",
  "google.svg": "Google",
  "jumia.png": "Jumia",
  "avito.svg": "Avito",
};

export default function Marketplaces({ store, products, onExit, onChanged }: ToolProps) {
  const { lang } = useT();
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const [margin, setMargin] = useState(store.marketplace_margin ?? 20);
  const [channels, setChannels] = useState<Record<string, boolean>>(store.marketplaces ?? {});
  const [saved, setSaved] = useState<"idle" | "busy" | "ok" | "error">("idle");
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedUrl = `${typeof window === "undefined" ? "" : window.location.origin}${storeFiles(store.slug).feed}`;

  const published = useMemo(() => products.filter((p) => p.status === "published" && p.price != null), [products]);
  const counted = useMemo(() => published.filter((p) => p.stock != null).sort((a, b) => b.stock! - a.stock!), [published]);
  const uncounted = published.length - counted.length;

  const save = async (patch: { marketplace_margin?: number; marketplaces?: Record<string, boolean> }) => {
    setSaved("busy");
    const { error } = await supabase().from("stores").update(patch).eq("id", store.id);
    setSaved(error ? "error" : "ok");
    if (!error) onChanged();
  };

  // The slider saves once the finger rests, not at every step.
  const onMargin = (v: number) => {
    setMargin(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save({ marketplace_margin: v }), 600);
  };
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const toggle = (id: string, on: boolean) => {
    const next = { ...channels, [id]: on };
    setChannels(next);
    void save({ marketplaces: next });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(feedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt(L("Copiez le lien", "Copy the link"), feedUrl);
    }
  };

  return (
    <div className="min-h-full bg-white pb-10 text-ink">
      <Header title="Marketplaces" hint={L("Stock partagé avec une marge de sécurité", "Shared stock with a safety margin")} onExit={onExit} />

      <div className="mx-auto max-w-md px-5">
        <Diagram margin={margin} lang={lang} />

        <section className="ui-card mt-3 rounded-xl p-4">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-medium">{L("Marge de sécurité", "Safety margin")}</p>
            <p className="text-[22px] font-semibold tabular-nums">{margin} %</p>
          </div>
          <input
            type="range"
            min={0}
            max={50}
            step={5}
            value={margin}
            onChange={(e) => onMargin(Number(e.target.value))}
            aria-label={L("Marge de sécurité", "Safety margin")}
            className="mt-3 w-full accent-[var(--brand)]"
          />
          <div className="flex justify-between text-[11px] text-ink-3 tabular-nums">
            <span>0 %</span>
            <span>25 %</span>
            <span>50 %</span>
          </div>
          <p className="mt-2 text-[13px] leading-snug text-ink-3">
            {L(
              "Si le comptage se trompe de quelques pièces, la marge évite de vendre en ligne un produit qui n'est plus en rayon.",
              "If the count is off by a few items, the margin stops you selling online a product no longer on the shelf.",
            )}
          </p>
          <p className="mt-1 h-4 text-[13px] leading-4">
            {saved === "busy" && <span className="text-ink-3">{L("Enregistrement", "Saving")}</span>}
            {saved === "ok" && <span className="text-ok">{L("Enregistré", "Saved")}</span>}
            {saved === "error" && <span className="text-danger">{L("Pas enregistré, réessayez.", "Not saved, try again.")}</span>}
          </p>
        </section>

        <h2 className="mt-7 text-sm font-semibold">{L("Où vendre", "Where to sell")}</h2>
        <section className="ui-card mt-2 divide-y divide-line rounded-xl">
          {CHANNELS.map((c) => {
            const on = !c.soon && !!channels[c.id];
            return (
              <div key={c.id}>
                <div className="flex items-center gap-3 p-3">
                  <Logos files={c.logos} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                    <p className="text-[13px] text-ink-3">{c.tag[lang === "fr" ? 0 : 1]}</p>
                  </div>
                  {c.soon ? (
                    <span className="rounded bg-soft px-1.5 py-0.5 text-[11px] font-medium text-ink-3">{L("Bientôt", "Soon")}</span>
                  ) : (
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label={c.name}
                      className="h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full bg-line transition-colors before:mt-0.5 before:block before:h-4 before:w-4 before:translate-x-0.5 before:rounded-full before:bg-white before:shadow before:transition-transform checked:bg-brand checked:before:translate-x-[18px]"
                      checked={on}
                      onChange={(e) => toggle(c.id, e.target.checked)}
                    />
                  )}
                </div>
                {on && c.how && (
                  <div className="px-3 pb-3">
                    <div className="flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate rounded-md bg-soft px-2 py-1.5 font-mono text-[13px]">{feedUrl}</code>
                      <button type="button" onClick={() => void copy()} className="ui-btn ui-btn-soft h-8 px-3 text-[13px]">
                        {copied ? L("Copié", "Copied") : L("Copier", "Copy")}
                      </button>
                    </div>
                    <p className="mt-2 text-[13px] leading-snug text-ink-3">{c.how[lang === "fr" ? 0 : 1]}</p>
                  </div>
                )}
              </div>
            );
          })}
        </section>

        <h2 className="mt-7 text-sm font-semibold">{L("Ce que voient les marketplaces", "What marketplaces see")}</h2>
        {counted.length === 0 ? (
          <p className="ui-card mt-2 rounded-xl p-4 text-sm text-ink-3">
            {L("Aucun produit en ligne avec un stock compté. Comptez le stock depuis l'onglet Produits.", "No live product with a counted stock. Count the stock from the Products tab.")}
          </p>
        ) : (
          <section className="ui-card mt-2 overflow-hidden rounded-xl">
            <div className="grid grid-cols-[1fr_64px_96px] items-center gap-2 border-b border-line px-3 py-2 text-[11px] font-medium text-ink-3">
              <span>{L("Produit", "Product")}</span>
              <span className="text-end">{L("Boutique", "Shop")}</span>
              <span className="text-end">Marketplaces</span>
            </div>
            {counted.map((p) => {
              const shown = marketplaceQty(p.stock!, margin);
              const kept = p.stock! - shown;
              const cover = coverOf(p);
              return (
                <div key={p.id} className="grid grid-cols-[1fr_64px_96px] items-center gap-2 border-b border-line px-3 py-2 last:border-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-white ring-1 ring-line">
                      {cover && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={cover} alt="" className="h-full w-full object-contain" />
                      )}
                    </span>
                    <span dir="auto" className="truncate text-[13px] font-medium">
                      {p.name}
                    </span>
                  </div>
                  <span className="text-end text-sm tabular-nums text-ink-3">{p.stock}</span>
                  <span className="flex items-baseline justify-end gap-1.5">
                    {kept > 0 && <span className="text-[11px] tabular-nums text-ink-3">−{kept}</span>}
                    <span className={`text-sm font-semibold tabular-nums ${shown === 0 ? "text-danger" : "text-ink"}`}>{shown}</span>
                  </span>
                </div>
              );
            })}
          </section>
        )}
        {uncounted > 0 && (
          <p className="mt-2 text-[13px] text-ink-3">
            {L(
              `${uncounted} produits sans stock compté sont affichés « en stock », sans quantité.`,
              `${uncounted} products without a counted stock are shown "in stock", with no quantity.`,
            )}
          </p>
        )}
      </div>
    </div>
  );
}

// The real brand logos in a white tile with the hairline; Meta's channel shows two, side by side.
function Logos({ files }: { files: string[] }) {
  const two = files.length > 1;
  return (
    <span className={`ui-card flex h-10 shrink-0 items-center justify-center gap-1 ${two ? "px-1.5" : "w-10"}`}>
      {files.map((f) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={f} src={`/brands/${f}`} alt={BRAND_NAME[f]} width={two ? 20 : 28} height={two ? 20 : 28} className={`${two ? "h-5 w-5" : "h-7 w-7"} object-contain`} />
      ))}
    </span>
  );
}

// Shop stock 50 on the left, what marketplaces see on the right, the margin kept in between.
function Diagram({ margin, lang }: { margin: number; lang: string }) {
  const shop = 50;
  const shown = marketplaceQty(shop, margin);
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  return (
    <section className="ui-card mt-2 rounded-xl p-4">
      <div className="flex items-center gap-3 text-center">
        <div className="flex-1">
          <p className="text-[28px] font-semibold leading-tight tabular-nums">{shop}</p>
          <p className="text-[13px] text-ink-3">{L("Boutique", "Shop")}</p>
        </div>
        <div className="flex flex-col items-center text-ink-3">
          <span className="text-[13px] font-medium tabular-nums">−{margin} %</span>
          <svg width="44" height="12" viewBox="0 0 44 12" className="mt-0.5 rtl:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M2 6h38M35 2l5 4-5 4" />
          </svg>
        </div>
        <div className="flex-1">
          <p className="text-[28px] font-semibold leading-tight tabular-nums">{shown}</p>
          <p className="text-[13px] text-ink-3">Marketplaces</p>
        </div>
      </div>
      <p className="mt-3 border-t border-line pt-3 text-center text-[13px] text-ink-3">
        {L(`${shop - shown} pièces gardées en réserve pour la boutique.`, `${shop - shown} items kept back for the shop.`)}
      </p>
    </section>
  );
}
