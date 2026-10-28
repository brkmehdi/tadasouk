"use client";

// Selling at the counter: scan each product's barcode (or tap it if it has none), adjust the
// quantities, then send the receipt to the customer on WhatsApp. Validating the sale lowers
// the stock of the products that have one.

import { useEffect, useRef, useState } from "react";
import { readBarcode, warmUpBarcodes } from "@/lib/capture/barcode";
import { cover, displayName, type Product } from "@/lib/capture/session";
import { beep } from "@/lib/capture/sfx";
import { phoneDigits } from "@/lib/phone";
import { formatPrice } from "./ProductCard";

type Line = { productId: string; qty: number };

const SCAN_EVERY_MS = 400;
const SAME_CODE_MS = 1500; // the same barcode held in view counts once

export default function SellMode({
  products,
  currency,
  storeName,
  onSold,
  onExit,
}: {
  products: Product[];
  currency: string;
  storeName: string;
  onSold: (lines: Line[]) => void;
  onExit: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const lastRef = useRef({ code: "", at: 0 });
  const productsRef = useRef(products);
  const [lines, setLines] = useState<Line[]>([]);
  const [notice, setNotice] = useState<{ text: string; tone: "ok" | "warn"; n: number } | null>(null);
  const [lastAdded, setLastAdded] = useState<{ id: string; n: number } | null>(null);
  const [phone, setPhone] = useState("");
  const [cameraError, setCameraError] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  const add = (p: Product, by: "scan" | "tap") => {
    if (p.price == null) {
      setNotice({ text: `Ajoutez d’abord un prix à « ${displayName(p)} »`, tone: "warn", n: Date.now() });
      return;
    }
    setLines((ls) => {
      const found = ls.find((l) => l.productId === p.id);
      return found ? ls.map((l) => (l === found ? { ...l, qty: l.qty + 1 } : l)) : [...ls, { productId: p.id, qty: 1 }];
    });
    setLastAdded({ id: p.id, n: Date.now() });
    setDone(false);
    if (by === "scan") beep(audioRef.current);
    navigator.vibrate?.(25);
  };

  // Camera and scanning loop.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    audioRef.current = new AudioContext();
    warmUpBarcodes();
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        const v = videoRef.current!;
        v.muted = true;
        v.playsInline = true;
        v.srcObject = stream;
        await v.play().catch(() => {});
      } catch {
        setCameraError(true);
        return;
      }
      const tick = async () => {
        if (stopped) return;
        const v = videoRef.current;
        if (v && v.readyState >= 2) {
          const code = await readBarcode(v);
          const now = Date.now();
          if (code && !(code === lastRef.current.code && now - lastRef.current.at < SAME_CODE_MS)) {
            lastRef.current = { code, at: now };
            const p = productsRef.current.find((x) => x.barcode === code);
            if (p) add(p, "scan");
            else setNotice({ text: `Code ${code} : produit inconnu`, tone: "warn", n: now });
          } else if (code) {
            lastRef.current.at = now;
          }
        }
        timer = window.setTimeout(tick, SCAN_EVERY_MS);
      };
      void tick();
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      audioRef.current?.close().catch(() => {});
    };
    // add() only reads refs and setters; the loop runs once for the life of the screen.
  }, []);

  const byId = new Map(products.map((p) => [p.id, p]));
  const rows = lines.map((l) => ({ ...l, p: byId.get(l.productId) })).filter((r) => r.p && r.qty > 0) as (Line & { p: Product })[];
  const total = rows.reduce((t, r) => t + (r.p.price ?? 0) * r.qty, 0);
  const setQty = (id: string, qty: number) => setLines((ls) => ls.map((l) => (l.productId === id ? { ...l, qty: Math.max(0, qty) } : l)).filter((l) => l.qty > 0));

  const receipt = () => {
    const date = new Date().toLocaleString("fr-MA", { dateStyle: "short", timeStyle: "short" });
    const body = rows.map((r) => `${r.qty} × ${displayName(r.p)} — ${formatPrice((r.p.price ?? 0) * r.qty, currency)}`).join("\n");
    return `*Reçu — ${storeName}*\n${date}\n\n${body}\n\n*Total : ${formatPrice(total, currency)}*\nMerci pour votre achat !`;
  };
  const finish = (sendReceipt: boolean) => {
    if (!rows.length) return;
    if (sendReceipt) {
      const to = phoneDigits(phone);
      window.open(`https://wa.me/${to}?text=${encodeURIComponent(receipt())}`, "_blank", "noopener");
    }
    onSold(rows.map(({ productId, qty }) => ({ productId, qty })));
    setLines([]);
    setPhone("");
    setDone(true);
  };

  const sellable = [...products].sort((a, b) => b.order - a.order);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white text-ink">
      {/* scanner */}
      <div className="relative h-[36dvh] shrink-0 overflow-hidden bg-black">
        <video ref={videoRef} playsInline muted autoPlay className="h-full w-full object-cover" />
        <div className="pointer-events-none absolute inset-x-10 top-1/2 h-24 -translate-y-1/2 rounded-xl border-2 border-dashed border-white/80" />
        <p className="absolute inset-x-0 bottom-3 text-center text-sm text-white drop-shadow">
          {cameraError ? "Caméra indisponible : touchez les produits ci-dessous" : "Scannez le code-barres"}
        </p>
        <button
          type="button"
          onClick={onExit}
          className="absolute start-3 top-[max(0.75rem,env(safe-area-inset-top))] rounded-full bg-black/50 px-3 py-1.5 text-sm font-medium text-white backdrop-blur"
        >
          Retour
        </button>
        {notice && (
          <p
            key={notice.n}
            className={`toast absolute inset-x-6 top-[max(0.75rem,env(safe-area-inset-top))] ms-16 rounded-lg px-3 py-1.5 text-center text-[13px] font-medium shadow ${
              notice.tone === "warn" ? "bg-white text-danger" : "bg-white text-ink"
            }`}
          >
            {notice.text}
          </p>
        )}
      </div>

      {/* products to tap (for those without a barcode) */}
      <div className="no-scrollbar flex shrink-0 gap-2 overflow-x-auto border-b border-black/10 px-4 py-3">
        {sellable.map((p) => {
          const img = cover(p);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => add(p, "tap")}
              className="w-[72px] shrink-0 text-start active:scale-95"
              aria-label={`Ajouter ${displayName(p)}`}
            >
              <span className="block aspect-square overflow-hidden rounded-md bg-white ring-1 ring-black/10">
                {img && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img.url} alt="" className="h-full w-full object-contain" />
                )}
              </span>
              <span dir="auto" className="mt-1 block truncate text-[11px] font-medium">
                {displayName(p)}
              </span>
              <span className="block text-[11px] text-ink-3 tabular-nums">
                {p.price != null ? formatPrice(p.price, p.currency) : "Prix ?"}
              </span>
            </button>
          );
        })}
      </div>

      {/* the sale */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-3">{done ? "Vente enregistrée." : "Scannez ou touchez un produit."}</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => {
              const img = cover(r.p);
              return (
                <li
                  key={r.productId}
                  className={`flex items-center gap-3 ${lastAdded?.id === r.productId ? "line-in" : ""}`}
                  data-n={lastAdded?.id === r.productId ? lastAdded.n : undefined}
                >
                  {img && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={img.url} alt="" className="h-10 w-10 shrink-0 rounded object-contain ring-1 ring-black/10" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p dir="auto" className="truncate text-sm font-medium">
                      {displayName(r.p)}
                    </p>
                    <p className="text-xs text-ink-3 tabular-nums">{formatPrice(r.p.price ?? 0, currency)}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => setQty(r.productId, r.qty - 1)} className="ui-btn ui-btn-soft h-8 w-8 p-0" aria-label="Moins">
                      −
                    </button>
                    <span className="w-6 text-center text-sm font-medium tabular-nums">{r.qty}</span>
                    <button type="button" onClick={() => setQty(r.productId, r.qty + 1)} className="ui-btn ui-btn-soft h-8 w-8 p-0" aria-label="Plus">
                      +
                    </button>
                  </div>
                  <span className="w-20 text-end text-sm font-semibold tabular-nums">{formatPrice((r.p.price ?? 0) * r.qty, currency)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* total and receipt */}
      <div className="shrink-0 border-t border-black/10 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex items-baseline justify-between">
          <span className="text-base font-medium text-ink-2">Total</span>
          <span className="text-[28px] leading-tight font-semibold tracking-tight tabular-nums">{formatPrice(total, currency)}</span>
        </div>
        <label className="ui-label mt-2" htmlFor="sell-phone">
          WhatsApp du client <span className="font-normal text-ink-3">(facultatif)</span>
        </label>
        <input
          id="sell-phone"
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="06 12 34 56 78"
          className="ui-input"
        />
        <button type="button" disabled={!rows.length} onClick={() => finish(true)} className="ui-btn ui-btn-primary mt-3 h-12 w-full text-base">
          Envoyer le reçu sur WhatsApp
        </button>
        <button type="button" disabled={!rows.length} onClick={() => finish(false)} className="ui-btn mt-1 h-10 w-full text-sm text-ink-2">
          Terminer sans reçu
        </button>
      </div>
    </div>
  );
}
