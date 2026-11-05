"use client";

// Ads: the merchant picks a product, the AI writes a Facebook and Instagram ad (/api/ads): text
// in French, Darija or Arabic, a headline, a button, an audience around the store's city and a
// daily budget. The ad is shown as it would look in the Instagram feed, an Instagram story and
// the Facebook feed; every text can be edited. Publishing needs the merchant's Meta Ads account,
// not connected yet, so nothing runs from here.

import { useMemo, useState } from "react";
import type { AdDraft } from "@/app/api/ads/route";
import { coverOf, type CatalogProduct } from "@/lib/catalog/types";
import { useT } from "@/lib/i18n";
import { formatPrice } from "@/lib/money";
import type { ToolProps } from "./types";
import { Header } from "./Visibility";

type Voice = "fr" | "darija" | "ar";
const VOICES: { id: Voice; label: string }[] = [
  { id: "fr", label: "Français" },
  { id: "darija", label: "Darija" },
  { id: "ar", label: "العربية" },
];

// Reach per day, a rough range from typical Moroccan prices per 1,000 views (12 to 35 dirhams)
// and people seeing the ad 1.1 to 1.3 times a day. Meta gives the real figure at launch.
function reach(budget: number, currency: string) {
  const k = currency === "EUR" ? 10 : 1;
  const round = (v: number) => Math.max(100, Math.round(v / 100) * 100);
  return [round(((budget * k) / 35) * 1000 / 1.3), round(((budget * k) / 12) * 1000 / 1.1)];
}

export default function AdsStudio({ store, products, onExit }: ToolProps) {
  const { lang } = useT();
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const [sessionId] = useState(() => crypto.randomUUID());
  const live = useMemo(() => products.filter((p) => p.status === "published"), [products]);
  const [picked, setPicked] = useState<CatalogProduct | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ad, setAd] = useState<AdDraft | null>(null);
  const [voice, setVoice] = useState<Voice>("fr");
  const [budget, setBudget] = useState(50);
  const [slide, setSlide] = useState(0);
  const [askedPublish, setAskedPublish] = useState(false);
  const [copied, setCopied] = useState(false);

  const write = async (p: CatalogProduct) => {
    setBusy(true);
    setError(null);
    setAskedPublish(false);
    try {
      const res = await fetch("/api/ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, productId: p.id }),
      });
      const data = (await res.json().catch(() => ({}))) as { ad?: AdDraft; message?: string };
      if (!res.ok || !data.ad) throw new Error(data.message ?? L("L'IA n'a pas répondu. Réessayez.", "The AI did not answer. Try again."));
      setAd(data.ad);
      setBudget(data.ad.daily_budget);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const pick = (p: CatalogProduct) => {
    setPicked(p);
    setAd(null);
    void write(p);
  };

  const key = voice === "fr" ? "primary_fr" : voice === "darija" ? "primary_darija" : "primary_ar";
  const edit = (patch: Partial<AdDraft>) => setAd((a) => (a ? { ...a, ...patch } : a));
  const cta = ad?.cta === "SEND_WHATSAPP_MESSAGE" ? L("Envoyer un message WhatsApp", "Send WhatsApp message") : L("Acheter", "Shop now");
  const ctaShort = ad?.cta === "SEND_WHATSAPP_MESSAGE" ? L("Envoyer un message", "Send message") : cta; // the Facebook button is narrow
  const lo = store.currency === "EUR" ? 2 : 20;
  const [rLo, rHi] = reach(budget, store.currency);
  const fmt = (n: number) => n.toLocaleString(lang === "fr" ? "fr-FR" : "en-US");

  const copy = async () => {
    if (!ad) return;
    try {
      await navigator.clipboard.writeText(`${ad[key]}\n\n${ad.headline}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // The texts stay on screen to copy by hand.
    }
  };

  return (
    <div className="min-h-full bg-white pb-12 text-ink">
      <Header title={L("Publicités", "Ads")} hint="Facebook · Instagram" onExit={onExit} />

      <div className="mx-auto max-w-md px-5">
        <section className="mt-2">
          <h2 className="text-sm font-semibold">{L("Vos vidéos Instagram", "Your Instagram videos")}</h2>
          <div className="ui-card mt-2 flex items-center gap-3 rounded-xl p-4">
            <span className="ui-card flex h-10 w-10 shrink-0 items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brands/instagram.svg" alt="Instagram" width={28} height={28} className="h-7 w-7" />
            </span>
            <p className="text-[13px] leading-snug text-ink-3">
              {L(
                "Aucune vidéo Instagram pour l'instant. Vos vidéos qui marchent le mieux apparaîtront ici pour en faire une pub.",
                "No Instagram videos yet. Your best performing videos will show here, ready to become an ad.",
              )}
            </p>
          </div>
        </section>

        <section className="mt-7">
          <h2 className="text-sm font-semibold">{L("Choisir un produit", "Pick a product")}</h2>
          {live.length === 0 ? (
            <p className="ui-card mt-2 rounded-xl p-4 text-sm text-ink-3">{L("Publiez un produit pour en faire une pub.", "Publish a product to advertise it.")}</p>
          ) : (
            <div className="mt-2 grid grid-cols-4 gap-2">
              {live.map((p) => {
                const cover = coverOf(p);
                const on = picked?.id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => pick(p)}
                    disabled={busy}
                    aria-pressed={on}
                    className={`min-w-0 text-start active:scale-[0.98] ${busy && !on ? "opacity-50" : ""}`}
                  >
                    <span className={`relative block aspect-square overflow-hidden rounded-md bg-white ${on ? "ring-2 ring-ink" : "ring-1 ring-line"}`}>
                      {cover && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={cover} alt="" className="h-full w-full object-contain" />
                      )}
                      {on && busy && <span className="absolute inset-0 bg-white/50 motion-safe:animate-pulse" />}
                    </span>
                    <span dir="auto" className="mt-1 block truncate text-[11px] font-medium">
                      {p.name}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {busy && (
          <div className="ui-card mt-4 flex items-center gap-3 rounded-xl p-4">
            <span className="h-5 w-5 shrink-0 rounded-full border-2 border-line border-t-ink motion-safe:animate-spin" />
            <p className="text-sm text-ink-2">{L("L'IA écrit votre publicité en français, darija et arabe.", "The AI is writing your ad in French, Darija and Arabic.")}</p>
          </div>
        )}
        {error && !busy && (
          <p className="mt-4 text-sm text-danger">
            {error}
            {picked && (
              <button type="button" onClick={() => void write(picked)} className="ms-2 font-medium text-brand">
                {L("Réessayer", "Retry")}
              </button>
            )}
          </p>
        )}

        {ad && picked && !busy && (
          <div>
            <div className="mt-7 flex items-center justify-between">
              <h2 className="text-sm font-semibold">{L("Aperçu", "Preview")}</h2>
              <div className="flex rounded-md bg-soft p-0.5 text-[13px] font-medium" role="group" aria-label={L("Langue de la pub", "Ad language")}>
                {VOICES.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setVoice(v.id)}
                    aria-pressed={voice === v.id}
                    className={`rounded px-2 py-1 ${voice === v.id ? "bg-white text-ink shadow-sm" : "text-ink-3"}`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>

            <div
              className="no-scrollbar -mx-5 mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-[7%] pb-2"
              onScroll={(e) => {
                const el = e.currentTarget;
                setSlide(Math.round(el.scrollLeft / (el.scrollWidth / 3)));
              }}
            >
              {[
                <IgFeed key="ig" sponsored={L("Sponsorisé", "Sponsored")} store={store.name} photo={coverOf(picked)} text={ad[key]} cta={cta} />,
                <IgStory key="story" sponsored={L("Sponsorisé", "Sponsored")} store={store.name} photo={coverOf(picked)} headline={ad.headline} cta={cta} price={picked.price != null ? formatPrice(picked.price, store.currency) : null} />,
                <FbFeed key="fb" store={store.name} photo={coverOf(picked)} text={ad[key]} headline={ad.headline} cta={ctaShort} domain={typeof window === "undefined" ? "" : window.location.host} lang={lang} />,
              ].map((el, i) => (
                <div key={i} className="w-[86%] shrink-0 snap-center">
                  <p className="mb-1.5 text-center text-[11px] font-medium text-ink-3">
                    {[L("Instagram · fil", "Instagram · feed"), "Instagram · story", L("Facebook · fil", "Facebook · feed")][i]}
                  </p>
                  {el}
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-center gap-1.5" aria-hidden>
              {[0, 1, 2].map((i) => (
                <span key={i} className={`h-1.5 w-1.5 rounded-full ${slide === i ? "bg-ink" : "bg-line"}`} />
              ))}
            </div>

            <section className="ui-card mt-5 rounded-xl p-4">
              <label className="block">
                <span className="ui-label">
                  {L("Texte principal", "Primary text")} ({VOICES.find((v) => v.id === voice)!.label})
                </span>
                <textarea
                  dir="auto"
                  className="ui-input h-auto min-h-24 resize-none py-2 leading-snug"
                  rows={4}
                  value={ad[key]}
                  maxLength={500}
                  onChange={(e) => edit({ [key]: e.target.value } as Partial<AdDraft>)}
                />
              </label>
              <label className="mt-3 block">
                <span className="ui-label">{L("Titre", "Headline")}</span>
                <input dir="auto" className="ui-input" value={ad.headline} maxLength={60} onChange={(e) => edit({ headline: e.target.value })} />
              </label>
              <label className="mt-3 block">
                <span className="ui-label">{L("Bouton", "Button")}</span>
                <select className="ui-input" value={ad.cta} onChange={(e) => edit({ cta: e.target.value as AdDraft["cta"] })}>
                  <option value="SHOP_NOW">{L("Acheter", "Shop now")}</option>
                  {store.whatsapp && <option value="SEND_WHATSAPP_MESSAGE">{L("Envoyer un message WhatsApp", "Send WhatsApp message")}</option>}
                </select>
              </label>
            </section>

            <section className="ui-card mt-3 rounded-xl p-4">
              <p className="text-sm font-medium">{L("Qui la verra", "Who will see it")}</p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                <div className="rounded-md bg-soft p-2.5">
                  <p className="text-[11px] text-ink-3">{L("Autour de", "Around")}</p>
                  <p className="truncate text-sm font-semibold tabular-nums">
                    {ad.audience.city} · {ad.audience.radius_km} km
                  </p>
                </div>
                <div className="rounded-md bg-soft p-2.5">
                  <p className="text-[11px] text-ink-3">{L("Âge", "Age")}</p>
                  <p className="text-sm font-semibold tabular-nums">
                    {ad.audience.age_min} {L("à", "to")} {ad.audience.age_max} {L("ans", "")}
                  </p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {ad.audience.interests.map((i) => (
                  <span key={i} dir="auto" className="rounded bg-soft px-1.5 py-0.5 text-[13px] text-ink-2">
                    {i}
                  </span>
                ))}
              </div>
              {ad.why && <p className="mt-2 text-[13px] leading-snug text-ink-3">{ad.why}</p>}
            </section>

            <section className="ui-card mt-3 rounded-xl p-4">
              <div className="flex items-baseline justify-between">
                <p className="text-sm font-medium">{L("Budget par jour", "Daily budget")}</p>
                <p className="text-[22px] font-semibold tabular-nums">{formatPrice(budget, store.currency)}</p>
              </div>
              <input
                type="range"
                min={lo}
                max={lo * 25}
                step={store.currency === "EUR" ? 1 : 10}
                value={budget}
                onChange={(e) => setBudget(Number(e.target.value))}
                aria-label={L("Budget par jour", "Daily budget")}
                className="mt-3 w-full accent-[var(--brand)]"
              />
              <div className="mt-3 rounded-md bg-soft p-3">
                <p className="text-[13px] text-ink-3">{L("Estimation", "Estimate")}</p>
                <p className="text-base font-semibold tabular-nums">
                  {fmt(rLo)} {L("à", "to")} {fmt(rHi)} {L("personnes par jour", "people a day")}
                </p>
                <p className="mt-0.5 text-[11px] text-ink-3">
                  {L(
                    `Suggestion de l'IA : ${formatPrice(ad.daily_budget, store.currency)}. Chiffre indicatif, Meta donne la portée réelle au lancement.`,
                    `AI suggestion: ${formatPrice(ad.daily_budget, store.currency)}. A rough figure, Meta gives the real reach at launch.`,
                  )}
                </p>
              </div>
            </section>

            <button type="button" onClick={() => setAskedPublish(true)} className="ui-btn ui-btn-primary mt-5 h-auto min-h-11 w-full whitespace-normal py-2 text-center leading-tight">
              {L("Connectez votre compte Meta Ads pour publier", "Connect your Meta Ads account to publish")}
            </button>
            {askedPublish && (
              <p className="mt-2 rounded-md bg-soft p-3 text-[13px] leading-snug text-ink-2">
                {L(
                  "La connexion à Meta Ads arrive bientôt dans Tadasouk. En attendant, copiez le texte et collez-le dans Meta Ads Manager.",
                  "The Meta Ads connection is coming to Tadasouk. Meanwhile, copy the text and paste it in Meta Ads Manager.",
                )}
              </p>
            )}
            <button type="button" onClick={() => void copy()} className="ui-btn ui-btn-secondary mt-2 h-11 w-full">
              {copied ? L("Texte copié", "Text copied") : L("Copier le texte", "Copy the text")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Ad previews. They imitate each platform's own neutral look (white post, black text) with
// its real logo on top; the store's avatar is the product photo, as small shops often have.

const PlatformBar = ({ logo, name }: { logo: "instagram" | "facebook"; name: string }) => (
  <div className="flex items-center gap-1.5 border-b border-black/5 px-3 py-2">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={`/brands/${logo}.svg`} alt={name} width={18} height={18} className="h-[18px] w-[18px]" />
    <span className="text-[13px] font-semibold">{name}</span>
  </div>
);

const Avatar = ({ photo, size = 32 }: { photo: string | null; size?: number }) => (
  <span className="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white ring-1 ring-black/10" style={{ width: size, height: size }}>
    {photo && (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={photo} alt="" className="h-full w-full object-contain p-0.5" />
    )}
  </span>
);

const Photo = ({ src, className }: { src: string | null; className: string }) => (
  <div className={`flex items-center justify-center bg-white ${className}`}>
    {src && (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" className="h-full w-full object-contain p-3" />
    )}
  </div>
);

const More = ({ className }: { className?: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
    <circle cx="5" cy="12" r="1.6" />
    <circle cx="12" cy="12" r="1.6" />
    <circle cx="19" cy="12" r="1.6" />
  </svg>
);

function IgFeed({ store, photo, text, cta, sponsored }: { store: string; photo: string | null; text: string; cta: string; sponsored: string }) {
  return (
    <div className="ui-card overflow-hidden rounded-xl text-[13px] text-black">
      <PlatformBar logo="instagram" name="Instagram" />
      <div className="flex items-center gap-2 px-3 py-2">
        <Avatar photo={photo} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate font-semibold">{store}</p>
          <p className="text-[11px] text-black/60">{sponsored}</p>
        </div>
        <More className="text-black/70" />
      </div>
      <Photo src={photo} className="aspect-square" />
      <div className="flex items-center justify-between bg-[#efefef] px-3 py-2.5 text-[13px] font-semibold text-[#0095f6]">
        <span className="truncate">{cta}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 rtl:rotate-180" aria-hidden>
          <path d="m9 6 6 6-6 6" />
        </svg>
      </div>
      <div className="flex gap-3.5 px-3 pt-2.5" aria-hidden>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
        </svg>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M20 12a8 8 0 1 1-3.2-6.4L20 4.5l-.9 3.6A8 8 0 0 1 20 12z" />
        </svg>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
          <path d="M21 3 10 14M21 3l-7 18-4-7-7-4z" />
        </svg>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="ms-auto">
          <path d="M6 3h12v18l-6-5-6 5z" />
        </svg>
      </div>
      <p dir="auto" className="line-clamp-3 whitespace-pre-line px-3 pb-3 pt-1.5 leading-snug">
        <span className="font-semibold">{store}</span> {text}
      </p>
    </div>
  );
}

function IgStory({ store, photo, headline, cta, price, sponsored }: { store: string; photo: string | null; headline: string; cta: string; price: string | null; sponsored: string }) {
  return (
    <div className="ui-card relative mx-auto flex aspect-[9/16] max-h-[470px] flex-col overflow-hidden rounded-xl text-black">
      <div className="px-3 pt-3">
        <div className="h-0.5 overflow-hidden rounded-full bg-black/10">
          <div className="h-full w-2/5 bg-black/60" />
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          <Avatar photo={photo} size={28} />
          <p className="min-w-0 truncate text-[13px] font-semibold">{store}</p>
          <p className="shrink-0 text-[11px] text-black/60">{sponsored}</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brands/instagram.svg" alt="Instagram" width={18} height={18} className="ms-auto h-[18px] w-[18px] shrink-0" />
        </div>
      </div>
      <Photo src={photo} className="min-h-0 flex-1" />
      <div className="flex flex-col items-center px-4 pb-4 text-center">
        <p dir="auto" className="line-clamp-2 text-[16px] font-semibold leading-tight">
          {headline}
        </p>
        {price && <p className="mt-1 text-[13px] font-semibold tabular-nums text-black/70">{price}</p>}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-2 text-black/60" aria-hidden>
          <path d="m6 15 6-6 6 6" />
        </svg>
        <span className="mt-0.5 max-w-full truncate rounded-full bg-white px-4 py-1.5 text-[13px] font-semibold text-black ring-1 ring-black/15">{cta}</span>
      </div>
    </div>
  );
}

function FbFeed({ store, photo, text, headline, cta, domain, lang }: { store: string; photo: string | null; text: string; headline: string; cta: string; domain: string; lang: string }) {
  return (
    <div className="ui-card overflow-hidden rounded-xl text-[13px] text-[#050505]" style={{ fontFamily: "Helvetica, Arial, sans-serif" }}>
      <PlatformBar logo="facebook" name="Facebook" />
      <div className="flex items-center gap-2 px-3 pt-3">
        <Avatar photo={photo} size={36} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate font-semibold">{store}</p>
          <p className="flex items-center gap-1 text-[11px] text-[#65676b]">
            {lang === "fr" ? "Sponsorisé" : "Sponsored"} ·
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
            </svg>
          </p>
        </div>
        <More className="text-[#65676b]" />
      </div>
      <p dir="auto" className="line-clamp-3 whitespace-pre-line px-3 py-2 leading-snug">
        {text}
      </p>
      <Photo src={photo} className="aspect-square border-y border-black/5" />
      <div className="flex items-center gap-2 bg-[#f0f2f5] px-3 py-2.5">
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[11px] uppercase text-[#65676b]">{domain}</p>
          <p dir="auto" className="truncate text-[14px] font-semibold">
            {headline}
          </p>
        </div>
        <span className="max-w-[48%] shrink-0 truncate rounded-md bg-[#e4e6eb] px-3 py-2 text-[13px] font-semibold">{cta}</span>
      </div>
      <div className="flex justify-around border-t border-black/5 py-2 text-[13px] font-semibold text-[#65676b]">
        <span>{lang === "fr" ? "J'aime" : "Like"}</span>
        <span>{lang === "fr" ? "Commenter" : "Comment"}</span>
        <span>{lang === "fr" ? "Partager" : "Share"}</span>
      </div>
    </div>
  );
}
