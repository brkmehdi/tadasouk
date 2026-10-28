"use client";

// Settings: the store's name, city and WhatsApp, the payments it accepts, the language.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { shrink, uploadMedia } from "@/lib/catalog/photos";
import { mediaUrl } from "@/lib/catalog/types";
import { displayPhone, phoneDigits } from "@/lib/phone";
import { useT } from "@/lib/i18n";
import { supabase } from "@/lib/supabase/browser";
import type { Store } from "./BackOffice";

export default function SettingsTab({ store, onSignOut }: { store: Store; onSignOut: () => void }) {
  const { t, lang, setLang } = useT();
  const router = useRouter();
  const [name, setName] = useState(store.name);
  const [city, setCity] = useState(store.city ?? "");
  const [whatsapp, setWhatsapp] = useState(store.whatsapp ? displayPhone(store.whatsapp) : "");
  const [cod, setCod] = useState(store.cod_enabled);
  const [credit, setCredit] = useState(store.credit_enabled);
  const [tagline, setTagline] = useState(store.tagline ?? "");
  const [state, setState] = useState<"idle" | "busy" | "saved" | "error">("idle");

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("busy");
    const { error } = await supabase()
      .from("stores")
      .update({
        name: name.trim(),
        city: city.trim() || null,
        whatsapp: phoneDigits(whatsapp) || null,
        tagline: tagline.trim() || null,
        cod_enabled: cod,
        credit_enabled: credit,
      })
      .eq("id", store.id);
    setState(error ? "error" : "saved");
    if (!error) router.refresh();
  };

  return (
    <form className="mt-2 flex flex-col gap-4" onSubmit={(e) => void save(e)}>
      <h1 className="text-lg font-semibold tracking-[-0.01em]">{t("settings.title")}</h1>

      <label className="block">
        <span className="ui-label">{t("settings.name")}</span>
        <input className="ui-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
      </label>
      <label className="block">
        <span className="ui-label">{t("settings.city")}</span>
        <input className="ui-input" value={city} onChange={(e) => setCity(e.target.value)} />
      </label>
      <label className="block">
        <span className="ui-label">{t("settings.whatsapp")}</span>
        <input className="ui-input" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} inputMode="tel" placeholder="06 12 34 56 78" />
      </label>

      <Look store={store} />
      <label className="block">
        <span className="ui-label">{t("settings.tagline")}</span>
        <input
          className="ui-input"
          value={tagline}
          onChange={(e) => setTagline(e.target.value)}
          maxLength={140}
          placeholder={t("settings.taglineHint")}
        />
      </label>

      <fieldset className="ui-card p-4">
        <legend className="sr-only">{t("settings.payments")}</legend>
        <p className="text-sm font-medium">{t("settings.payments")}</p>
        <Toggle label={t("settings.cod")} checked={cod} onChange={setCod} />
        <Toggle label={t("settings.card")} hint={t("settings.cardSoon")} checked={false} disabled onChange={() => {}} />
        <Toggle label={t("settings.credit")} checked={credit} onChange={setCredit} />
      </fieldset>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={state === "busy"} className="ui-btn ui-btn-primary h-10 px-5">
          {t("settings.save")}
        </button>
        {state === "saved" && <span className="text-sm text-ok">{t("settings.saved")}</span>}
        {state === "error" && <span className="text-sm text-danger">{t("common.error")}</span>}
      </div>

      <div className="ui-card flex items-center justify-between p-4">
        <span className="text-sm font-medium">{t("settings.language")}</span>
        <div className="flex rounded-md bg-soft p-0.5 text-sm font-medium">
          {(
            [
              ["fr", "Français"],
              ["en", "English"],
            ] as const
          ).map(([l, label]) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              aria-pressed={lang === l}
              className={`rounded px-3 py-1 ${lang === l ? "bg-white text-ink shadow-sm" : "text-ink-3"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <button type="button" onClick={onSignOut} className="self-start text-sm text-ink-3">
        {t("settings.signOut")}
      </button>
    </form>
  );
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={`mt-3 flex items-center gap-3 ${disabled ? "opacity-50" : ""}`}>
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{label}</span>
        {hint && <span className="block text-xs text-ink-3">{hint}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        className="h-5 w-9 cursor-pointer appearance-none rounded-full bg-line transition-colors before:mt-0.5 before:block before:h-4 before:w-4 before:translate-x-0.5 before:rounded-full before:bg-white before:shadow before:transition-transform checked:bg-brand checked:before:translate-x-[18px]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

// The store's banner: a photo from the phone, one made by the AI on request, or none (the store
// then shows its name). Changes apply at once; the public store shows them on its next visit.
function Look({ store }: { store: Store }) {
  const { t } = useT();
  const router = useRouter();
  const [busy, setBusy] = useState<"upload" | "ai" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (kind: "upload" | "ai" | "remove", fn: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t("common.error"));
    } finally {
      setBusy(null);
    }
  };

  const setHero = async (key: string | null) => {
    const { error } = await supabase().from("stores").update({ hero_key: key }).eq("id", store.id);
    if (error) throw error;
  };

  return (
    <section className="ui-card overflow-hidden">
      <div className="relative aspect-[16/7] bg-soft">
        {store.hero_key ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mediaUrl(store.hero_key)} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <p className="absolute inset-0 flex items-center justify-center px-4 text-center text-lg font-semibold">{store.name}</p>
        )}
        {busy && <div className="shimmer absolute inset-0" />}
      </div>
      <div className="p-4">
        <p className="text-sm font-medium">{t("settings.look")}</p>
        <p className="mt-0.5 text-xs text-ink-3">{t("settings.lookHint")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <label className={`ui-btn ui-btn-secondary h-9 cursor-pointer px-3 text-[13px] ${busy ? "pointer-events-none opacity-50" : ""}`}>
            {t("settings.heroPhoto")}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file)
                  void run("upload", async () => setHero(await uploadMedia(await shrink(file, 2000), `kind=hero&image=${crypto.randomUUID()}`)));
              }}
            />
          </label>
          <button
            type="button"
            disabled={!!busy}
            onClick={() =>
              void run("ai", async () => {
                const res = await fetch("/api/store-hero", { method: "POST" });
                if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { message?: string }).message ?? "");
              })
            }
            className="ui-btn ui-btn-secondary h-9 px-3 text-[13px]"
          >
            {busy === "ai" ? t("settings.heroMaking") : t("settings.heroAi")}
          </button>
          {store.hero_key && (
            <button type="button" disabled={!!busy} onClick={() => void run("remove", () => setHero(null))} className="ui-btn h-9 px-3 text-[13px] text-danger hover:bg-soft">
              {t("settings.heroRemove")}
            </button>
          )}
        </div>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        <a href={`/${store.slug}`} target="_blank" rel="noopener" className="mt-3 inline-block text-sm font-medium text-brand">
          {t("settings.viewStore")} ↗
        </a>
      </div>
    </section>
  );
}
