"use client";

// One product: the gallery (the photos of the chosen colour) with thumbnails and "Va bien avec"
// on the left; name, price, quantity, description, colour discs, size boxes, the add button,
// what the buyer can count on and the details on the right. On a phone, a bar with the add
// button stays at the bottom once the main one has scrolled away.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatPrice } from "@/lib/money";
import { delayText, isSoldOut, pctOff, type ShopProduct } from "@/lib/shop";
import { useCart } from "./cart";
import { PayButton, QtyPicker, type PayState } from "./controls";
import { BackIcon, CashIcon, ChatIcon, ChevronDown, TruckIcon } from "./icons";
import { suggestions, Upsell } from "./Upsell";

export type Photo = { url: string; colorId: string | null };

export function ProductView({ product: p, photos, shareUrl }: { product: ShopProduct; photos: Photo[]; shareUrl: string }) {
  const { store, products, shipping, add, openDrawer } = useCart();
  const [color, setColor] = useState<string | null>(p.colors[0]?.id ?? null);
  const [size, setSize] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [slide, setSlide] = useState(0);
  const [needSize, setNeedSize] = useState(false);
  const [state, setState] = useState<"ready" | "busy" | "done">("ready");
  const [picking, setPicking] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [barShown, setBarShown] = useState(false);
  const addRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = addRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setBarShown(!e.isIntersecting && e.boundingClientRect.top < 0));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const own = photos.filter((f) => color && f.colorId === color);
  const shown = own.length ? own : photos.filter((f) => !f.colorId).length ? photos.filter((f) => !f.colorId) : photos;
  const current = shown[Math.min(slide, shown.length - 1)];
  const chosen = p.colors.find((c) => c.id === color);
  const money = (n: number) => formatPrice(n, store.currency);
  const off = pctOff(p);
  const canBuy = p.price != null && p.inStock && !p.draft;
  const ready = canBuy && (!p.sizes.length || !!size);
  const pairs = suggestions(products, [p.category], new Set([p.id]), 6);

  const addToCart = () => {
    if (!canBuy || state !== "ready") return;
    if (p.sizes.length && !size) {
      setNeedSize(true);
      document.getElementById("pdp-size")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setState("busy");
    add(p.id, color, size, qty);
    setTimeout(() => setState("done"), 450);
    setTimeout(() => {
      openDrawer();
      setState("ready");
    }, 1100);
  };
  const buttonState: PayState = state === "ready" ? (ready ? "ready" : "idle") : state;
  const button = (cls = "") => (
    <PayButton
      state={buttonState}
      label={canBuy ? "Ajouter au panier" : p.price == null ? "Prix sur demande" : p.draft ? "Brouillon" : "Épuisé"}
      busyLabel="Ajout…"
      doneLabel="Ajouté au panier"
      onClick={addToCart}
      className={`${cls} ${canBuy ? "" : "opacity-60"}`}
    />
  );

  const ship = shipping[0];
  const details: [string, string, React.ReactNode][] = [
    [
      "ship",
      "Livraison",
      shipping.length ? (
        <ul className="flex flex-col gap-1">
          {shipping.map((s) => (
            <li key={s.id}>
              {s.name} : {s.price ? money(s.price) : "gratuite"}
              {s.free_over != null && s.price ? `, offerte dès ${money(s.free_over)}` : ""}
              {delayText(s.delay_days) ? ` (${delayText(s.delay_days)})` : ""}
            </li>
          ))}
        </ul>
      ) : (
        "Le vendeur vous confirme la livraison et son prix sur WhatsApp après la commande."
      ),
    ],
    [
      "pay",
      "Paiement",
      [store.cod && "En espèces à la livraison.", store.credit && "À crédit, avec des échéances proposées par le vendeur.", "Carte bancaire : bientôt."]
        .filter(Boolean)
        .join(" "),
    ],
    [
      "help",
      "Une question ?",
      store.whatsapp ? (
        <a href={`https://wa.me/${store.whatsapp}?text=${encodeURIComponent(`Bonjour, une question sur « ${p.name} » : ${shareUrl}`)}`} target="_blank" rel="noopener" className="underline underline-offset-2">
          Écrivez au vendeur sur WhatsApp
        </a>
      ) : (
        "Le vendeur vous répond après votre commande."
      ),
    ],
  ];

  return (
    <div className="grid gap-10 pt-8 md:grid-cols-2 md:gap-[100px] md:pt-12">
      <div className="min-w-0">
        <Link
          href={p.categorySlug ? `/${store.slug}/c/${p.categorySlug}` : `/${store.slug}/boutique`}
          className="group -ms-5 mb-4 inline-flex items-center gap-1.5 ps-5 text-[14px] font-medium"
        >
          <BackIcon size={12} className="-ms-5 text-ink-3 transition-transform group-hover:-translate-x-0.5" />
          {p.category ?? "Tous les produits"}
        </Link>
        <div className="relative aspect-square overflow-hidden rounded-lg bg-[#F3F3F5]">
          {current && (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={current.url} src={current.url} alt={`${p.name}${chosen ? `, ${chosen.name}` : ""}`} className="shop-fade-up h-full w-full object-contain p-[4%] mix-blend-multiply" />
          )}
          {shown.length > 1 && (
            <span className="absolute end-2 bottom-2 rounded bg-white/90 px-1.5 py-0.5 text-[12px] tabular-nums">
              {Math.min(slide, shown.length - 1) + 1} / {shown.length}
            </span>
          )}
        </div>
        {shown.length > 1 && (
          <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto">
            {shown.map((f, i) => (
              <button
                key={f.url}
                type="button"
                onClick={() => setSlide(i)}
                aria-label={`Photo ${i + 1} sur ${shown.length}`}
                className={`h-14 w-14 shrink-0 overflow-hidden rounded bg-[#F3F3F5] ${i === Math.min(slide, shown.length - 1) ? "ring-2 ring-ink" : ""}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.url} alt="" className="h-full w-full object-contain mix-blend-multiply" />
              </button>
            ))}
          </div>
        )}
        <div className="hidden md:block">
          <Upsell title="Va bien avec" items={pairs} />
        </div>
      </div>

      <div className="min-w-0">
        {p.draft && <p className="mb-3 inline-block rounded bg-ink px-2 py-0.5 text-xs font-medium text-white">Brouillon : visible par vous seulement</p>}
        <h1 className="text-[22px] font-bold leading-tight tracking-[-0.025em] text-[#16151A]">{p.name}</h1>
        {p.category && <p className="mt-0.5 text-[14px] text-ink-3">{p.category}</p>}
        <div className="mt-4 flex items-center gap-3">
          <span className="text-[34px] font-semibold tabular-nums tracking-[-0.03em] text-[#16151A]">{p.price != null ? money(p.price) : "Sur demande"}</span>
          {p.compareAt != null && <s className="text-[16px] text-ink-3 tabular-nums">{money(p.compareAt)}</s>}
          {off > 0 && <span className="rounded bg-[#d7f5e6] px-1.5 py-0.5 text-[12px] font-medium text-[#0a7d4e]">-{off} %</span>}
          {canBuy && (
            <button type="button" onClick={() => setPicking(true)} className="shop-qty ms-auto mt-0" aria-label={`Quantité ${qty}, modifier`}>
              Qté {qty} <ChevronDown size={10} />
            </button>
          )}
        </div>
        {p.description && <p className="mt-4 text-[14px] leading-[1.55] text-ink-2">{p.description}</p>}

        {p.colors.length > 0 && (
          <div className="mt-6">
            <div className="mb-2 flex justify-between text-[13px] font-medium text-ink-2">
              <span>Couleur</span>
              <span className="font-normal text-ink-3">{chosen?.name}</span>
            </div>
            <div className="flex flex-wrap gap-3" role="radiogroup" aria-label="Couleur">
              {p.colors.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={c.id === color}
                  aria-label={c.name}
                  onClick={() => {
                    setColor(c.id);
                    setSlide(0);
                    if (size && isSoldOut(p, c.id, size)) setSize(null);
                  }}
                  className={`h-8 w-8 rounded-full ring-1 ring-black/15 ring-offset-2 transition-shadow ${c.id === color ? "ring-2 ring-ink" : ""}`}
                  style={{ background: c.hex }}
                />
              ))}
            </div>
          </div>
        )}

        {p.sizes.length > 0 && (
          <div id="pdp-size" className="mt-6 scroll-mt-24">
            <div className="mb-2 flex justify-between text-[13px] font-medium text-ink-2">
              <span>Taille</span>
              {needSize && !size && <span className="text-[12px] font-medium tracking-wide text-danger uppercase">Requis</span>}
            </div>
            <div
              role="radiogroup"
              aria-label="Taille"
              className={`grid overflow-hidden rounded-md ${p.sizes.length <= 3 ? "grid-cols-3" : "grid-cols-6"} ${needSize && !size ? "shadow-[0_0_0_1px_rgb(239,152,150)]" : "shadow-[0_0_0_1px_var(--line),0_2px_4px_rgba(0,0,0,.07)]"}`}
            >
              {p.sizes.map((s, i) => {
                const out = isSoldOut(p, color, s);
                return (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={s === size}
                    disabled={out}
                    aria-label={out ? `${s}, épuisé` : s}
                    onClick={() => {
                      setSize(s);
                      setNeedSize(false);
                    }}
                    className={`h-10 text-[14px] font-medium ${i % 6 ? "border-s border-[var(--line)]" : ""} ${i >= 6 ? "border-t border-[var(--line)]" : ""} ${
                      s === size ? "bg-[#1a1a1a] text-white" : out ? "text-ink-3/50 line-through" : "hover:bg-soft"
                    }`}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
            {needSize && !size && <p className="shop-fade-up mt-1.5 text-[13px] text-danger">Choisissez une taille pour l&apos;ajouter au panier.</p>}
          </div>
        )}

        <div ref={addRef} className="mt-6">
          {button()}
        </div>

        <ul className="mt-6 flex flex-col gap-2 text-[13px] text-ink-2">
          <li className="flex items-center gap-2">
            <TruckIcon size={14} className="text-ink-3" />
            {ship
              ? `${ship.name} : ${ship.price ? money(ship.price) : "gratuite"}${ship.free_over != null && ship.price ? `, offerte dès ${money(ship.free_over)}` : ""}`
              : "Livraison confirmée par le vendeur sur WhatsApp"}
          </li>
          {store.cod && (
            <li className="flex items-center gap-2">
              <CashIcon size={14} className="text-ink-3" />
              Paiement en espèces à la livraison
            </li>
          )}
          <li className="flex items-center gap-2">
            <ChatIcon size={14} className="text-ink-3" />
            <a href={`https://wa.me/?text=${encodeURIComponent(`${p.name}${p.price != null ? ` · ${money(p.price)}` : ""}\n${shareUrl}`)}`} target="_blank" rel="noopener" className="underline underline-offset-2">
              Partager sur WhatsApp
            </a>
          </li>
        </ul>

        <div className="mt-6 overflow-hidden rounded-md shadow-[0_0_0_1px_var(--line),0_2px_4px_rgba(0,0,0,.07)]">
          {details.map(([k, title, body], i) => (
            <div key={k} className={i ? "border-t border-[var(--line)]" : ""}>
              <button
                type="button"
                aria-expanded={open === k}
                onClick={() => setOpen(open === k ? null : k)}
                className="flex h-[52px] w-full items-center justify-between px-4 text-[14px] hover:bg-soft"
              >
                {title}
                <ChevronDown size={12} className={`transition-transform ${open === k ? "rotate-180" : ""}`} />
              </button>
              <div className={`grid transition-[grid-template-rows] duration-300 ${open === k ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                <div className="overflow-hidden">
                  <div className="px-4 pb-4 text-[14px] leading-[1.5] text-ink-2">{body}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="md:hidden">
          <Upsell title="Va bien avec" items={pairs} />
        </div>
      </div>

      {canBuy && (
        <div
          aria-hidden={!barShown}
          className={`fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-line bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-transform duration-300 md:hidden ${
            barShown ? "translate-y-0" : "translate-y-full"
          }`}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-medium">
              {p.name}
              {size ? `, ${size}` : ""}
            </p>
            <p className="text-[13px] text-ink-3 tabular-nums">{money((p.price ?? 0) * qty)}</p>
          </div>
          <div className="w-[52%]">{button("h-11 text-[15px]")}</div>
        </div>
      )}

      {picking && (
        <QtyPicker
          name={p.name}
          image={current?.url ?? null}
          qty={qty}
          min={1}
          onClose={() => setPicking(false)}
          onSave={(n) => {
            setQty(n);
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}
