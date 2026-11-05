"use client";

// Visibility: how the store shows up on Google and to AI assistants, checked live. The checklist
// reads the store's real public files (sitemap, robots, llms.txt, a product page) and the score
// comes from it; the Google result is drawn from the best product's own title and description;
// the AI panel shows the llms.txt file exactly as assistants read it.

import { useEffect, useMemo, useState } from "react";
import { coverOf, type CatalogProduct } from "@/lib/catalog/types";
import { useT } from "@/lib/i18n";
import { formatPrice } from "@/lib/money";
import { storeFiles } from "@/lib/visibility";
import type { ToolProps } from "./types";

type State = "wait" | "ok" | "part" | "no";
type Check = { id: string; weight: number; ratio: number; state: State; title: string; detail: string };

type Live = {
  sitemap: { listed: boolean; pages: number } | null;
  robots: { ai: boolean } | null;
  llms: string | null | false; // false: not live
  page: { jsonLd: boolean; og: boolean } | null;
};

export default function Visibility({ store, products, orders, onExit }: ToolProps) {
  const { lang } = useT();
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const published = useMemo(() => products.filter((p) => p.status === "published"), [products]);
  const best = useMemo(() => bestProduct(published, orders), [published, orders]);
  const files = storeFiles(store.slug);
  const [live, setLive] = useState<Live | null>(null);

  useEffect(() => {
    let gone = false;
    const text = (u: string) =>
      fetch(u, { cache: "no-store" })
        .then((r) => (r.ok ? r.text() : null))
        .catch(() => null);
    void Promise.all([text("/sitemap.xml"), text("/robots.txt"), text(files.llms), best ? text(`/${store.slug}/${best.id}`) : Promise.resolve(null)]).then(
      ([sitemap, robots, llms, page]) => {
        if (gone) return;
        setLive({
          sitemap: sitemap == null ? null : { listed: sitemap.includes(`/${store.slug}</loc>`), pages: sitemap.split(`/${store.slug}/`).length - 1 },
          robots: robots == null ? null : { ai: /GPTBot/.test(robots) && /Sitemap:/i.test(robots) && !/Disallow:\s*\/\s*$/m.test(robots) },
          llms: llms ?? false,
          page: page == null ? null : { jsonLd: page.includes("application/ld+json"), og: page.includes('property="og:image"') },
        });
      },
    );
    return () => {
      gone = true;
    };
  }, [store.slug, files.llms, best]);

  const checks = useMemo<Check[]>(() => {
    const n = published.length;
    const withPhoto = published.filter((p) => coverOf(p)).length;
    const withPrice = published.filter((p) => p.price != null).length;
    const withText = published.filter((p) => (p.description?.trim().length ?? 0) >= 40).length;
    const wait = !live;
    const st = (ok: boolean, ratio = ok ? 1 : 0): State => (wait ? "wait" : ok ? (ratio >= 1 ? "ok" : "part") : "no");
    const part = (a: number, b: number) => (b ? a / b : 0);
    return [
      {
        id: "published",
        weight: 20,
        ratio: store.published ? 1 : 0,
        state: store.published ? "ok" : "no",
        title: L("Boutique en ligne", "Store is live"),
        detail: store.published ? L("Tout le monde peut l'ouvrir.", "Anyone can open it.") : L("Publiez la boutique pour être trouvé.", "Publish the store to be found."),
      },
      {
        id: "sitemap",
        weight: 15,
        ratio: live?.sitemap?.listed ? 1 : 0,
        state: st(!!live?.sitemap?.listed),
        title: L("Plan du site pour Google", "Sitemap for Google"),
        detail: live?.sitemap?.listed
          ? L(`La boutique et ${live.sitemap.pages} pages produits sont listées.`, `The store and ${live.sitemap.pages} product pages are listed.`)
          : L("La boutique n'y est pas encore.", "The store is not in it yet."),
      },
      {
        id: "schema",
        weight: 20,
        ratio: live?.page?.jsonLd ? part(withPrice, n) : 0,
        state: st(!!live?.page?.jsonLd && withPrice > 0, part(withPrice, n)),
        title: L(`${withPrice} pages produits avec fiche Google`, `${withPrice} product pages with Google data`),
        detail: L("Nom, photo, prix et stock lisibles par Google (schema.org).", "Name, photo, price and stock Google can read (schema.org)."),
      },
      {
        id: "og",
        weight: 15,
        ratio: live?.page?.og ? part(withPhoto, n) : 0,
        state: st(!!live?.page?.og && withPhoto > 0, part(withPhoto, n)),
        title: L("Aperçus WhatsApp et Facebook", "WhatsApp and Facebook previews"),
        detail: L(`${withPhoto} sur ${n} produits s'affichent avec photo et prix quand on partage le lien.`, `${withPhoto} of ${n} products show a photo and price when the link is shared.`),
      },
      {
        id: "llms",
        weight: 15,
        ratio: live?.llms ? 1 : 0,
        state: st(!!live?.llms),
        title: L("Fichier pour les assistants IA", "File for AI assistants"),
        detail: live?.llms ? L("llms.txt est en ligne avec vos produits et prix.", "llms.txt is live with your products and prices.") : L("En ligne dès que la boutique est publiée.", "Live as soon as the store is published."),
      },
      {
        id: "robots",
        weight: 5,
        ratio: live?.robots?.ai ? 1 : 0,
        state: st(!!live?.robots?.ai),
        title: L("Robots IA invités", "AI crawlers welcome"),
        detail: L("Google, ChatGPT, Claude et Perplexity peuvent lire la boutique.", "Google, ChatGPT, Claude and Perplexity may read the store."),
      },
      {
        id: "text",
        weight: 10,
        ratio: part(withText, n),
        state: n === 0 ? "no" : withText === n ? "ok" : withText > 0 ? "part" : "no",
        title: L("Descriptions complètes", "Full descriptions"),
        detail: L(`${withText} sur ${n} produits ont une vraie description. Elle grandit à chaque produit filmé.`, `${withText} of ${n} products have a real description. It grows with every product you film.`),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, published, store.published, lang]);

  const score = live ? Math.round(checks.reduce((s, c) => s + c.weight * c.ratio, 0)) : 0;
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <div className="min-h-full bg-white pb-10 text-ink">
      <Header title={L("Visibilité", "Visibility")} hint={L("Google et assistants IA", "Google and AI assistants")} onExit={onExit} />

      <div className="mx-auto max-w-md px-5">
        <section className="ui-card mt-2 flex items-center gap-4 rounded-xl p-4">
          <ScoreRing score={score} ready={!!live} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{L("Score de visibilité", "Visibility score")}</p>
            <p className="mt-1 text-[13px] leading-snug text-ink-3">
              {L(
                `Il monte avec le temps : chaque produit publié ajoute une page à Google et une ligne pour les assistants. ${published.length} produits en ligne aujourd'hui.`,
                `It builds up over time: every product you publish adds a page on Google and a line for assistants. ${published.length} products online today.`,
              )}
            </p>
          </div>
        </section>

        <section className="ui-card mt-3 divide-y divide-line rounded-xl">
          {checks.map((c) => (
            <div key={c.id} className="flex items-start gap-3 p-3">
              <Mark state={c.state} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{c.title}</p>
                <p className="text-[13px] leading-snug text-ink-3">{c.detail}</p>
              </div>
            </div>
          ))}
        </section>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <a href="/sitemap.xml" target="_blank" rel="noopener" className="ui-btn ui-btn-secondary">
            {L("Plan du site", "Sitemap")}
          </a>
          <a href={files.llms} target="_blank" rel="noopener" className="ui-btn ui-btn-secondary">
            llms.txt
          </a>
        </div>

        <h2 className="mt-7 text-sm font-semibold">{L("Sur Google", "On Google")}</h2>
        <p className="text-[13px] text-ink-3">{L("Votre meilleur produit, tel qu'il peut apparaître.", "Your best product, as it can appear.")}</p>
        {best ? (
          <GoogleResult product={best} store={store} origin={origin} lang={lang} />
        ) : (
          <p className="ui-card mt-2 rounded-xl p-4 text-sm text-ink-3">{L("Publiez un produit pour voir l'aperçu.", "Publish a product to see the preview.")}</p>
        )}

        <h2 className="mt-7 text-sm font-semibold">{L("Pour les assistants IA", "For AI assistants")}</h2>
        <p className="text-[13px] text-ink-3">
          {L("Le fichier que lisent ChatGPT, Claude ou Perplexity pour connaître votre boutique.", "The file ChatGPT, Claude or Perplexity read to learn about your store.")}
        </p>
        <AiFile text={live?.llms} url={`${origin}${files.llms}`} lang={lang} />
      </div>
    </div>
  );
}

// The product that sold most (by order lines), else the most complete one.
function bestProduct(published: CatalogProduct[], orders: ToolProps["orders"]) {
  const sold = new Map<string, number>();
  for (const o of orders) if (o.status !== "cancelled") for (const i of o.order_items) sold.set(i.name, (sold.get(i.name) ?? 0) + i.quantity);
  const rank = (p: CatalogProduct) =>
    (sold.get(p.name) ?? 0) * 100 + (coverOf(p) ? 4 : 0) + (p.price != null ? 2 : 0) + ((p.description?.length ?? 0) > 40 ? 1 : 0);
  return [...published].sort((a, b) => rank(b) - rank(a))[0] ?? null;
}

// The header of every tool, like the back office's: a 32px round back button, the tool's name
// and one line under it.
export function Header({ title, hint, onExit }: { title: string; hint: string; onExit: () => void }) {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-3 bg-white/90 px-5 pt-[max(0.9rem,env(safe-area-inset-top))] pb-3 backdrop-blur">
      <button
        type="button"
        onClick={onExit}
        aria-label="Retour"
        className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-soft text-ink before:absolute before:-inset-1.5 before:content-[''] hover:bg-black/10"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="rtl:rotate-180" aria-hidden>
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-medium leading-tight">{title}</p>
        <p className="truncate text-[13px] text-ink-3">{hint}</p>
      </div>
    </header>
  );
}

// The photo preview's score ring: 52px, green from 70, ink from 50, red below, the number inside.
function ScoreRing({ score, ready }: { score: number; ready: boolean }) {
  if (!ready) return <span className="ui-skel h-[52px] w-[52px] shrink-0 rounded-full motion-safe:animate-pulse" />;
  const v = Math.max(0, Math.min(100, score));
  const c = 2 * Math.PI * 21;
  return (
    <svg width="52" height="52" viewBox="0 0 52 52" className="shrink-0" role="img" aria-label={`${v} / 100`}>
      <circle cx="26" cy="26" r="21" fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth="5" />
      <circle
        cx="26"
        cy="26"
        r="21"
        fill="none"
        stroke={v >= 70 ? "var(--ok)" : v >= 50 ? "var(--ink)" : "var(--danger)"}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={`${(v / 100) * c} ${c}`}
        transform="rotate(-90 26 26)"
      />
      <text x="26" y="30.5" textAnchor="middle" fontSize="14" fontWeight="600" fill="var(--ink)" className="tabular-nums">
        {v}
      </text>
    </svg>
  );
}

// A thin mark in front of each check: a tick (done), a dash (partly done), a cross (missing).
function Mark({ state }: { state: State }) {
  if (state === "wait") return <span className="ui-skel mt-0.5 h-5 w-5 shrink-0 rounded-full motion-safe:animate-pulse" />;
  const cls = state === "ok" ? "text-ok" : state === "part" ? "text-ink" : "text-danger";
  const label = state === "ok" ? "OK" : state === "part" ? "Partiel" : "Manquant";
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`mt-0.5 shrink-0 ${cls}`}
      role="img"
      aria-label={label}
    >
      {state === "ok" ? <path d="m5 12.5 4.5 4.5L19 7.5" /> : state === "part" ? <path d="M6 12h12" /> : <path d="M7 7l10 10M17 7 7 17" />}
    </svg>
  );
}

// Google's own result look (white, its blue title, grey text), inside the app's card.
function GoogleResult({ product: p, store, origin, lang }: { product: CatalogProduct; store: ToolProps["store"]; origin: string; lang: string }) {
  const cover = coverOf(p);
  const price = p.price != null ? formatPrice(p.price, store.currency) : null;
  // The same title and description as the product page's metadata.
  const title = `${price ? `${p.name} · ${price}` : p.name} · ${store.name}`;
  const description = (p.description ?? `${p.name}, chez ${store.name}.`).slice(0, 180);
  const host = origin.replace(/^https?:\/\//, "");
  const inStock = p.stock == null || p.stock > 0;
  return (
    <div className="ui-card mt-2 overflow-hidden rounded-xl p-4" style={{ fontFamily: "Arial, sans-serif" }}>
      <div className="mb-3 flex items-center gap-2 rounded-full bg-[#f1f3f4] px-3 py-2 text-[13px] text-[#5f6368]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brands/google.svg" alt="Google" width={16} height={16} className="h-4 w-4 shrink-0" />
        <span className="truncate">{`${p.name} ${store.city ?? ""}`.trim()}</span>
      </div>
      <div className="flex gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#f1f3f4] text-[#5f6368]" aria-hidden>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
              </svg>
            </span>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-[14px] text-[#202124]">{store.name}</p>
              <p className="truncate text-[12px] text-[#4d5156]">
                {host} › {store.slug}
              </p>
            </div>
          </div>
          <p className="mt-2 line-clamp-2 text-[18px] leading-snug text-[#1a0dab]">{title}</p>
          <p className="mt-1 line-clamp-3 text-[13px] leading-snug text-[#4d5156]">{description}</p>
          {price && (
            <p className="mt-1.5 text-[13px] text-[#4d5156]">
              <span className="font-semibold text-[#202124]">{price}</span>
              {" · "}
              <span className={inStock ? "text-[#188038]" : "text-[#d93025]"}>
                {inStock ? (lang === "fr" ? "En stock" : "In stock") : lang === "fr" ? "Épuisé" : "Out of stock"}
              </span>
            </p>
          )}
        </div>
        {cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" className="mt-9 h-[84px] w-[84px] shrink-0 rounded-lg bg-white object-contain ring-1 ring-[#ebebeb]" />
        )}
      </div>
    </div>
  );
}

// The llms.txt file as assistants read it: a plain card, the file's text in a soft block.
function AiFile({ text, url, lang }: { text: string | null | false | undefined; url: string; lang: string }) {
  const [open, setOpen] = useState(false);
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const lines = typeof text === "string" ? text.trimEnd().split("\n") : [];
  const shown = open ? lines : lines.slice(0, 14);
  return (
    <div className="ui-card mt-2 rounded-xl p-4">
      <p className="text-sm font-medium">{L("Assistant IA", "AI assistant")}</p>
      <p className="truncate text-[13px] text-ink-3">
        {L("lit", "reads")} {url}
      </p>
      {text === undefined ? (
        <div className="mt-3 space-y-2 rounded-md bg-soft p-3">
          {[80, 60, 90, 70].map((w) => (
            <div key={w} className="ui-skel h-3 motion-safe:animate-pulse" style={{ width: `${w}%` }} />
          ))}
        </div>
      ) : text === false || text === null ? (
        <p className="mt-3 rounded-md bg-soft p-3 text-sm text-ink-2">
          {L("Le fichier sera en ligne dès que la boutique est publiée.", "The file goes live as soon as the store is published.")}
        </p>
      ) : (
        <div className="mt-3 rounded-md bg-soft p-3">
          <pre dir="auto" className="whitespace-pre-wrap break-words font-mono text-[13px] leading-[1.55] text-ink">
            {shown.map((l, i) => (
              <span key={i} className={l.startsWith("#") ? "font-semibold" : l.startsWith(">") ? "text-ink-2" : undefined}>
                {l}
                {"\n"}
              </span>
            ))}
          </pre>
          {lines.length > 14 && (
            <button type="button" onClick={() => setOpen(!open)} className="mt-2 text-[13px] font-medium text-brand">
              {open ? L("Réduire", "Show less") : L(`Voir les ${lines.length} lignes`, `See all ${lines.length} lines`)}
            </button>
          )}
        </div>
      )}
      <p className="pt-2 text-[11px] text-ink-3">
        {L("Ce n'est pas une réponse d'IA : c'est le fichier lu, tel quel.", "This is not an AI answer: it is the file they read, as is.")}
      </p>
    </div>
  );
}
