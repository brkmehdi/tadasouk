"use client";

// Card payment in the shop: the merchant types the amount, the phone shows a big QR code of the
// Tchentchen payment's pay page, the customer scans it and pays with a card, Apple Pay or Google
// Pay on their own phone. The screen asks every 2 s and turns into "Payé" when it is done; Cancel
// cancels the payment. Tchentchen is the owner's payment service built before the hackathon:
// SmallStore only calls its public API (/api/pay/session, /status, /cancel) and says so under the code.

import qrcode from "qrcode-generator";
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { formatPrice } from "@/lib/money";
import type { ToolProps } from "./types";

const TX = {
  title: { fr: "Encaisser par carte", en: "Take a card payment" },
  amount: { fr: "Montant à encaisser", en: "Amount to take" },
  note: { fr: "Note (facultatif), ex. : 2 caftans", en: "Note (optional), e.g. 2 kaftans" },
  show: { fr: "Afficher le QR", en: "Show the QR code" },
  creating: { fr: "Préparation du QR", en: "Preparing the QR code" },
  scan: { fr: "Le client scanne avec son téléphone", en: "The customer scans it with their phone" },
  waiting: { fr: "En attente du paiement", en: "Waiting for the payment" },
  cancel: { fr: "Annuler", en: "Cancel" },
  paid: { fr: "Payé", en: "Paid" },
  again: { fr: "Nouvel encaissement", en: "New payment" },
  done: { fr: "Terminé", en: "Done" },
  expired: { fr: "Le QR a expiré. Le client n'a pas payé.", en: "The QR code expired. The customer did not pay." },
  failed: { fr: "Le paiement a été annulé.", en: "The payment was cancelled." },
  retry: { fr: "Nouveau QR", en: "New QR code" },
  upstream: { fr: "Tchentchen ne répond pas. Réessayez.", en: "Tchentchen does not answer. Try again." },
  tooSmall: { fr: "Ce montant est trop petit pour une carte (5 DH au moins).", en: "This amount is too small for a card (5 DH at least)." },
  notConnected: { fr: "Le paiement par carte n'est pas encore connecté.", en: "Card payment is not connected yet." },
  notConnectedHint: {
    fr: "Il passe par Tchentchen. Dès que la clé de Tchentchen est réglée sur le serveur, ce QR fonctionne.",
    en: "It runs through Tchentchen. As soon as Tchentchen's key is set on the server, this QR code works.",
  },
  label: {
    fr: "Tchentchen, service de paiement existant (antérieur au hackathon)",
    en: "Tchentchen, existing payment service (built before the hackathon)",
  },
  tap: { fr: "Tap to Pay sur téléphone : bientôt (application Android)", en: "Tap to Pay on the phone: soon (Android app)" },
  card: { fr: "Carte bancaire", en: "Card" },
  wallets: { apple_pay: "Apple Pay", google_pay: "Google Pay" } as Record<string, string>,
} as const;

type Method = { wallet: string | null; brand: string | null; last4: string | null };
type Phase =
  | { k: "keypad"; error?: "upstream" | "tooSmall" }
  | { k: "creating" }
  | { k: "qr"; id: string; url: string }
  | { k: "paid"; method: Method | null }
  | { k: "expired" }
  | { k: "failed" };

// "Apple Pay", or "Visa •••• 4242", or "Carte bancaire".
function methodText(m: Method | null, lang: "fr" | "en") {
  if (!m) return null;
  if (m.wallet && TX.wallets[m.wallet]) return TX.wallets[m.wallet];
  if (m.brand && m.last4) return `${m.brand.charAt(0).toUpperCase()}${m.brand.slice(1)} •••• ${m.last4}`;
  return TX.card[lang];
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "0", "del"] as const;

function QrCode({ text }: { text: string }) {
  const { d, n } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const size = qr.getModuleCount();
    let path = "";
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (qr.isDark(r, c)) path += `M${c} ${r}h1v1h-1z`;
    return { d: path, n: size };
  }, [text]);
  return (
    <svg viewBox={`-2 -2 ${n + 4} ${n + 4}`} className="block h-auto w-full" shapeRendering="crispEdges" role="img" aria-label="QR code">
      <rect x="-2" y="-2" width={n + 4} height={n + 4} fill="#fff" />
      <path d={d} fill="#1a1a1a" />
    </svg>
  );
}

export default function QrPay({ store, onExit, onChanged }: ToolProps) {
  const { lang } = useT();
  const [raw, setRaw] = useState("");
  const [note, setNote] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<Phase>({ k: "keypad" });

  const amount = Number(raw.replace(",", ".")) || 0;
  const money = (v: number) => formatPrice(v, store.currency);

  useEffect(() => {
    let live = true;
    fetch("/api/pay/session")
      .then((r) => r.json() as Promise<{ configured?: boolean }>)
      .then((b) => live && setConfigured(!!b.configured))
      .catch(() => live && setConfigured(false));
    return () => {
      live = false;
    };
  }, []);

  // The back office passes a new onChanged on each render: keep the latest without restarting the poll.
  const changed = useRef(onChanged);
  useEffect(() => {
    changed.current = onChanged;
  });

  // Every 2 s while the QR code is up: paid, expired or canceled ends the wait.
  const paymentId = phase.k === "qr" ? phase.id : null;
  useEffect(() => {
    if (!paymentId) return;
    let live = true;
    const tick = async () => {
      const res = await fetch(`/api/pay/status?id=${encodeURIComponent(paymentId)}`).catch(() => null);
      if (!live || !res?.ok) return;
      const b = (await res.json()) as { status?: string; method?: Method | null };
      if (!live) return;
      if (b.status === "paid") {
        setPhase({ k: "paid", method: b.method ?? null });
        changed.current();
      } else if (b.status === "expired") setPhase({ k: "expired" });
      else if (b.status === "canceled") setPhase({ k: "failed" });
    };
    const t = setInterval(() => void tick(), 2000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [paymentId]);

  // Cancel on screen cancels the payment too; if the customer paid meanwhile, it shows as paid.
  const cancel = async (id: string) => {
    setPhase({ k: "keypad" });
    const res = await fetch("/api/pay/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => null);
    const b = (await res?.json().catch(() => null)) as { status?: string } | null;
    if (b?.status === "paid") {
      setPhase({ k: "paid", method: null });
      changed.current();
    }
  };

  const press = (k: (typeof KEYS)[number]) => {
    setRaw((v) => {
      if (k === "del") return v.slice(0, -1);
      if (k === ",") return v.includes(",") ? v : `${v || "0"},`;
      const [int, dec] = v.split(",");
      if (dec !== undefined) return dec.length >= 2 ? v : v + k;
      if (int.length >= 6) return v;
      return int === "0" ? k : v + k;
    });
  };

  const show = async () => {
    if (amount <= 0) return;
    setPhase({ k: "creating" });
    const res = await fetch("/api/pay/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId: store.id, amount, note, lang }),
    }).catch(() => null);
    const b = (await res?.json().catch(() => ({}))) as { id?: string; url?: string; error?: string } | undefined;
    if (b?.error === "tct_not_configured") {
      setConfigured(false);
      setPhase({ k: "keypad" });
    } else if (res?.ok && b?.id && b.url) setPhase({ k: "qr", id: b.id, url: b.url });
    else setPhase({ k: "keypad", error: b?.error === "amount_too_small" ? "tooSmall" : "upstream" });
  };

  const restart = () => {
    setRaw("");
    setNote("");
    setPhase({ k: "keypad" });
  };

  const unit = store.currency === "EUR" ? "€" : "DH";

  return (
    <div className="flex min-h-dvh flex-col bg-white text-ink">
      <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b border-line bg-white px-3">
        <button type="button" onClick={onExit} aria-label={TX.done[lang]} className="flex h-10 w-10 items-center justify-center rounded-full text-ink hover:bg-soft">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <h1 className="flex-1 truncate text-lg font-semibold tracking-[-0.01em]">{TX.title[lang]}</h1>
        <span dir="auto" className="me-1 max-w-[40%] truncate text-[13px] text-ink-3">
          {store.name}
        </span>
      </header>

      {(phase.k === "keypad" || phase.k === "creating") && (
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <p className="mt-6 text-center text-[13px] text-ink-3">{TX.amount[lang]}</p>
          <p className={`mt-1 text-center text-[28px] leading-tight font-semibold tracking-tight tabular-nums ${raw ? "text-ink" : "text-ink-3"}`}>
            {raw || "0"} {unit}
          </p>
          <input
            className="ui-input mt-5 text-center"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={80}
            placeholder={TX.note[lang]}
            aria-label={TX.note[lang]}
            dir="auto"
          />

          {configured === false && (
            <div className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
              <p className="font-medium">{TX.notConnected[lang]}</p>
              <p className="mt-0.5 text-[13px]">{TX.notConnectedHint[lang]}</p>
            </div>
          )}
          {phase.k === "keypad" && phase.error && <p className="mt-3 text-center text-sm text-danger">{TX[phase.error][lang]}</p>}

          <div className="mt-auto grid grid-cols-3 gap-2 pt-6">
            {KEYS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => press(k)}
                aria-label={k === "del" ? "⌫" : k}
                className="ui-btn ui-btn-soft h-14 text-[22px] font-medium tabular-nums"
              >
                {k === "del" ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M9 5h11v14H9l-6-7zM13 9.5l5 5M18 9.5l-5 5" />
                  </svg>
                ) : (
                  k
                )}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={amount <= 0 || phase.k === "creating" || configured === false}
            onClick={() => void show()}
            className="ui-btn ui-btn-primary mt-4 h-12 w-full text-base"
          >
            {phase.k === "creating" ? TX.creating[lang] : amount > 0 ? `${TX.show[lang]} · ${money(amount)}` : TX.show[lang]}
          </button>
          <p className="mt-3 text-center text-[11px] text-ink-3">{TX.tap[lang]}</p>
        </div>
      )}

      {phase.k === "qr" && (
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div className="ui-card mt-6 w-full p-5">
            <p dir="auto" className="text-center text-[13px] font-medium text-ink-2">
              {store.name}
            </p>
            <p className="mt-1 text-center text-[28px] leading-tight font-semibold tracking-tight tabular-nums">{money(amount)}</p>
            {note && (
              <p dir="auto" className="mt-0.5 truncate text-center text-[13px] text-ink-3">
                {note}
              </p>
            )}
            <div className="mx-auto mt-4 w-full max-w-[280px]">
              <QrCode text={phase.url} />
            </div>
            <p className="mt-3 text-center text-[13px] text-ink-3">{TX.scan[lang]}</p>
            <p className="mt-1 text-center text-[11px] text-ink-3">{TX.label[lang]}</p>
          </div>

          <p className="mt-6 text-sm text-ink-2" role="status">
            {TX.waiting[lang]}
          </p>

          <button type="button" onClick={() => void cancel(phase.id)} className="ui-btn ui-btn-secondary mt-auto h-11 w-full">
            {TX.cancel[lang]}
          </button>
        </div>
      )}

      {phase.k === "paid" && (
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center px-5 pt-16 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-center">
          <p className="text-[28px] leading-tight font-semibold tracking-tight text-ok" role="status">
            {TX.paid[lang]}
          </p>
          <p className="mt-1 text-[22px] font-semibold tabular-nums">{money(amount)}</p>
          {phase.method && <p className="mt-2 text-sm text-ink-2">{methodText(phase.method, lang)}</p>}
          {note && (
            <p dir="auto" className="mt-1 text-[13px] text-ink-3">
              {note}
            </p>
          )}
          <p className="mt-4 text-[11px] text-ink-3">{TX.label[lang]}</p>
          <div className="mt-auto flex w-full flex-col gap-2 pt-8">
            <button type="button" onClick={restart} className="ui-btn ui-btn-primary h-12 w-full text-base">
              {TX.again[lang]}
            </button>
            <button type="button" onClick={onExit} className="ui-btn ui-btn-secondary h-11 w-full">
              {TX.done[lang]}
            </button>
          </div>
        </div>
      )}

      {(phase.k === "expired" || phase.k === "failed") && (
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center px-5 pt-16 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-center">
          <p className="text-base font-medium">{phase.k === "expired" ? TX.expired[lang] : TX.failed[lang]}</p>
          <p className="mt-1 text-[22px] font-semibold tabular-nums text-ink-3">{money(amount)}</p>
          <div className="mt-auto flex w-full flex-col gap-2 pt-8">
            <button type="button" onClick={() => void show()} className="ui-btn ui-btn-primary h-12 w-full text-base">
              {TX.retry[lang]}
            </button>
            <button type="button" onClick={restart} className="ui-btn ui-btn-secondary h-11 w-full">
              {TX.cancel[lang]}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
