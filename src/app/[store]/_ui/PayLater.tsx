"use client";

// "Payer par carte" on the thank-you page of a card order still unpaid: the server finds or makes
// the order's Tchentchen payment (/api/pay/order) and the buyer goes to Tchentchen's pay page,
// which brings them back here.

import { useRouter } from "next/navigation";
import { useState } from "react";

export function PayLater({ slug, order }: { slug: string; order: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/pay/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, order }),
    }).catch(() => null);
    const b = (await res?.json().catch(() => null)) as { url?: string; paid?: boolean; processing?: boolean; message?: string } | null;
    if (b?.url) {
      window.location.assign(b.url);
      return;
    }
    setBusy(false);
    if (b?.paid || b?.processing) router.refresh();
    else setError(b?.message ?? "Le paiement ne s'ouvre pas. Réessayez dans un instant.");
  };
  return (
    <div className="mt-3">
      <button type="button" onClick={() => void go()} disabled={busy} className="ui-btn ui-btn-primary h-11 w-full text-[15px]">
        {busy ? "Ouverture du paiement" : "Payer par carte"}
      </button>
      {error && <p className="mt-2 text-[13px] text-danger">{error}</p>}
    </div>
  );
}
