"use client";

// Card payment inside the checkout, through Tchentchen's browser SDK. The SDK is loaded with a
// script tag from Tchentchen (its code is not in this repository) and draws Stripe's card form in
// our page. The server creates the payment (/api/pay/payment) and hands the page only a client
// token. A changed total (delivery, promotion) makes a new payment: the old one is canceled and
// the form gets the new token (update); an amount is never changed. "Payer" places the order
// first (/api/orders checks the payment against it), then confirms the card. When the form cannot
// load, the same button sends the buyer to Tchentchen's pay page.

import { useCallback, useEffect, useRef, useState } from "react";

type ConfirmResult =
  | { status: "paid" | "processing"; paymentId: string }
  | { status: "error"; paymentId: string; error: { code: string; message: string } };
type CardHandle = {
  readonly payUrl: string;
  confirm(): Promise<ConfirmResult>;
  update(options: { clientToken: string }): Promise<void>;
  destroy(): void;
};
type MountOptions = {
  clientToken: string;
  locale?: string;
  onReady?: () => void;
  onChange?: (state: { complete: boolean; method: string | null }) => void;
  onUnavailable?: (info: { payUrl: string; reason: string }) => void;
};
export type CheckoutOptions = {
  checkoutUrl: string;
  mount?: string | HTMLElement;
  onEvent?: (name: string, data: Record<string, unknown>) => void;
  onComplete?: (info: { redirectUrl: string }) => void;
  onClose?: (info: { cancelUrl: string | null }) => void;
  onRenew?: () => Promise<string | null>;
};
type Factory = (options?: { locale?: string }) => {
  payment: { mount(target: HTMLElement, options: MountOptions): Promise<CardHandle> };
  checkout: {
    open(options: CheckoutOptions): { close(): void };
    resume(options: Omit<CheckoutOptions, "checkoutUrl">): { close(): void } | null;
  };
};

declare global {
  interface Window {
    TchenTchen?: Factory;
  }
}

export function loadSdk(src: string) {
  return new Promise<Factory>((resolve, reject) => {
    if (window.TchenTchen) return resolve(window.TchenTchen);
    let s = document.querySelector<HTMLScriptElement>("script[data-tchentchen-sdk]");
    if (!s) {
      s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.dataset.tchentchenSdk = "";
      document.head.appendChild(s);
    }
    s.addEventListener("load", () => (window.TchenTchen ? resolve(window.TchenTchen) : reject(new Error("no TchenTchen"))));
    s.addEventListener("error", () => reject(new Error("sdk blocked")));
  });
}

// fr by default; ar reaches Stripe's form only (Tchentchen's own pages fall back to French).
const pageLocale = () => {
  const l = document.documentElement.lang.slice(0, 2);
  return l === "ar" || l === "en" ? l : "fr";
};

export type CardInput = {
  slug: string;
  items: { product_id: string; quantity: number; color_id: string | null; size: string | null }[];
  shipping: string | null;
  promo: string | null;
  total: number | null; // null while the cart is being priced
  name: string;
  phone: string; // digits, as /api/orders takes them
};
export type CardPhase = "idle" | "loading" | "ready" | "unavailable" | "error";
export type OrderFields = { name: string; phone: string; city: string; address: string; note: string };
export type PayOutcome =
  | { kind: "paid"; orderId: string }
  | { kind: "redirect" }
  | { kind: "error"; message: string; orderId?: string; number?: number };

const keyOf = (i: CardInput) => JSON.stringify([i.items, i.shipping, i.promo, i.total]);

export function useCardPayment(sdk: string | null, active: boolean, input: CardInput) {
  const el = useRef<HTMLDivElement>(null);
  const handle = useRef<CardHandle | null>(null);
  const order = useRef<string | null>(null);
  const placed = useRef<{ id: string; number: number } | null>(null);
  const payment = useRef<{ id: string; url: string; key: string } | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef(input);
  const [phase, setPhaseState] = useState<CardPhase>("idle");
  const phaseRef = useRef<CardPhase>("idle");
  const [complete, setCompleteState] = useState(false);
  const completeRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const setPhase = useCallback((p: CardPhase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);
  const setComplete = useCallback((c: boolean) => {
    completeRef.current = c;
    setCompleteState(c);
  }, []);
  useEffect(() => {
    latest.current = input;
  });

  // One payment request at a time, in order.
  const refresh = useCallback(
    (force = false) => {
      const attempt = async () => {
        const inp = latest.current;
        if (!sdk || inp.total == null || placed.current) return;
        const key = keyOf(inp);
        if (!force && payment.current?.key === key) return;
        if (!handle.current && phaseRef.current !== "unavailable") setPhase("loading");
        setError(null);
        const res = await fetch("/api/pay/payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slug: inp.slug,
            items: inp.items,
            shipping: inp.shipping,
            promo: inp.promo,
            order: order.current ?? undefined,
            replace: payment.current?.id,
            attempt: crypto.randomUUID(),
            name: inp.name,
            phone: inp.phone,
            locale: pageLocale(),
          }),
        }).catch(() => null);
        const b = (await res?.json().catch(() => null)) as { order?: string; payment?: string; client_token?: string; url?: string; message?: string } | null;
        if (!res?.ok || !b?.order || !b.payment || !b.client_token || !b.url) {
          setPhase("error");
          setError(b?.message ?? "Le paiement par carte ne s'ouvre pas. Réessayez, ou choisissez un autre moyen de paiement.");
          return;
        }
        order.current = b.order;
        payment.current = { id: b.payment, url: b.url, key };
        if (handle.current) {
          await handle.current.update({ clientToken: b.client_token });
          if (phaseRef.current === "error") setPhase("ready");
          return;
        }
        if (phaseRef.current === "unavailable" || !el.current) return; // the pay page link follows payment.current
        try {
          const tct = (await loadSdk(sdk))({ locale: pageLocale() });
          handle.current = await tct.payment.mount(el.current, {
            clientToken: b.client_token,
            locale: pageLocale(),
            onReady: () => phaseRef.current !== "unavailable" && setPhase("ready"),
            onChange: (s) => setComplete(s.complete),
            onUnavailable: () => setPhase("unavailable"),
          });
          if (phaseRef.current === "loading") setPhase("ready");
        } catch {
          setPhase("unavailable"); // script blocked or an old browser: Tchentchen's pay page instead
        }
      };
      // A failed request or form update shows the error and the Réessayer link; it never throws.
      const run = () =>
        attempt().catch(() => {
          setPhase("error");
          setError("Le paiement par carte ne s'ouvre pas. Réessayez, ou choisissez un autre moyen de paiement.");
        });
      queue.current = queue.current.then(run, run);
      return queue.current;
    },
    [sdk, setPhase, setComplete],
  );

  // A new payment when Card is picked, and when the cart, delivery or promotion changes.
  const key = keyOf(input);
  useEffect(() => {
    if (!active || !sdk || input.total == null) return;
    const t = setTimeout(() => void refresh(), 350);
    return () => clearTimeout(t);
  }, [active, sdk, key, input.total, refresh]);

  useEffect(
    () => () => {
      handle.current?.destroy();
      handle.current = null;
    },
    [],
  );

  const pay = useCallback(
    async (fields: OrderFields): Promise<PayOutcome> => {
      await queue.current;
      if (!payment.current) await refresh(true);
      if (!payment.current) return { kind: "error", message: "Le paiement par carte ne s'ouvre pas. Réessayez." };
      // Only a form that is up and filled in, or Tchentchen's pay page when the form cannot load.
      const now = phaseRef.current;
      if (now === "idle" || now === "loading") return { kind: "error", message: "Le formulaire de carte se charge. Réessayez dans un instant." };
      if (now === "error") return { kind: "error", message: error ?? "Le paiement par carte ne s'ouvre pas. Réessayez." };
      if (now === "ready" && !completeRef.current) return { kind: "error", message: "Entrez les informations de votre carte." };

      if (!placed.current) {
        for (let attempt = 0; attempt < 2 && !placed.current; attempt++) {
          const inp = latest.current;
          const res = await fetch("/api/orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              slug: inp.slug,
              items: inp.items,
              ...fields,
              payment: "card",
              shipping: inp.shipping,
              promo: inp.promo,
              order_id: order.current,
              payment_id: payment.current.id,
            }),
          }).catch(() => null);
          const b = (await res?.json().catch(() => null)) as { id?: string; number?: number; error?: string; message?: string } | null;
          if (res?.ok && b?.id) {
            placed.current = { id: b.id, number: b.number ?? 0 };
          } else if (res?.status === 409 && b?.error === "payment_stale" && attempt === 0) {
            await refresh(true); // the total or the order number moved: a new payment, then once more
          } else {
            return { kind: "error", message: b?.message ?? "La commande n'est pas passée. Réessayez." };
          }
        }
        if (!placed.current) return { kind: "error", message: "La commande n'est pas passée. Réessayez." };
      }

      const { id, number } = placed.current;
      if (phaseRef.current === "unavailable" || !handle.current) {
        window.location.assign(payment.current.url);
        return { kind: "redirect" };
      }
      const r = await handle.current.confirm();
      if (r.status !== "error") return { kind: "paid", orderId: id };
      return {
        kind: "error",
        message: r.error?.message || "Le paiement n'est pas passé. Vérifiez la carte, ou essayez-en une autre.",
        orderId: id,
        number,
      };
    },
    [refresh, error],
  );

  return { el, phase, complete, error, retry: () => void refresh(true), pay, placed: () => placed.current };
}

export function CardForm({ card }: { card: ReturnType<typeof useCardPayment> }) {
  const { el, phase, error, retry } = card;
  return (
    <div className="mt-3">
      {phase === "loading" && <div className="shop-amt-skel h-[120px] w-full rounded-md" aria-label="Chargement du formulaire de carte" />}
      <div ref={el} className={phase === "unavailable" || phase === "error" ? "hidden" : ""} />
      {phase === "unavailable" && (
        <p className="rounded-md bg-[#f6f6f6] p-3 text-[13px] text-ink-2">
          Le formulaire de carte ne s&apos;affiche pas sur cet appareil. En appuyant sur Payer, vous terminez le paiement sur la page
          sécurisée de Tchentchen.
        </p>
      )}
      {phase === "error" && (
        <p className="text-[13px] text-danger">
          {error}{" "}
          <button type="button" onClick={retry} className="underline underline-offset-2">
            Réessayer
          </button>
        </p>
      )}
    </div>
  );
}
