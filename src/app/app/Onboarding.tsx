"use client";

// First visit: the store's name (its link comes from it), city and WhatsApp. Saved straight
// from the browser; the row level security policy only lets a merchant open their own store.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { displayPhone, phoneDigits } from "@/lib/phone";
import { supabase } from "@/lib/supabase/browser";

function toSlug(name: string) {
  const s = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36)
    .replace(/-+$/, "");
  return s.length >= 3 ? s : `boutique-${s || Math.random().toString(36).slice(2, 6)}`;
}

export default function Onboarding({ userId, phone }: { userId: string; phone?: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [whatsapp, setWhatsapp] = useState(phone ? displayPhone(phone) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const base = toSlug(name);
    // The link must be unique: on a clash, add a few digits and try again.
    for (const slug of [base, `${base}-${Math.floor(100 + Math.random() * 900)}`, `${base}-${Date.now() % 100000}`]) {
      const { error } = await supabase()
        .from("stores")
        .insert({ owner_id: userId, name: name.trim(), slug, city: city.trim() || null, whatsapp: phoneDigits(whatsapp) || null });
      if (!error) {
        router.refresh();
        return;
      }
      if (error.code !== "23505") break;
    }
    setError("Ça n'a pas marché. Réessayez.");
    setBusy(false);
  };

  return (
    <main className="flex min-h-dvh flex-col items-center bg-white px-6 pt-[14vh] text-ink">
      <form className="flex w-full max-w-sm flex-col gap-4" onSubmit={save}>
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em]">Votre boutique</h1>
          <p className="mt-1 text-sm text-ink-3">Trois informations, puis vous filmez vos produits.</p>
        </div>
        <div>
          <label className="ui-label" htmlFor="name">
            Nom de la boutique
          </label>
          <input id="name" className="ui-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoFocus />
          {name.trim() && <p className="mt-1.5 text-xs text-ink-3">Votre lien : /b/{toSlug(name)}</p>}
        </div>
        <div>
          <label className="ui-label" htmlFor="city">
            Ville
          </label>
          <input id="city" className="ui-input" value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2" />
        </div>
        <div>
          <label className="ui-label" htmlFor="whatsapp">
            WhatsApp de la boutique
          </label>
          <input
            id="whatsapp"
            className="ui-input"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            inputMode="tel"
            autoComplete="tel"
            placeholder="06 12 34 56 78"
          />
          <p className="mt-1.5 text-xs text-ink-3">Vos clients vous écrivent ici.</p>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <button type="submit" className="ui-btn ui-btn-primary h-11 w-full" disabled={busy || !name.trim()}>
          Ouvrir ma boutique
        </button>
      </form>
    </main>
  );
}
