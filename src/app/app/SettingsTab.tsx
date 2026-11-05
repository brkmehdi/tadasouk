"use client";

// Settings: the store's name, city and WhatsApp, its look, the payments it accepts, delivery
// methods, promotion codes, the language.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { shrink, uploadMedia } from "@/lib/catalog/photos";
import type { PromoCode, ShippingMethod } from "@/lib/catalog/store-settings";
import { mediaUrl } from "@/lib/catalog/types";
import { displayPhone, phoneDigits } from "@/lib/phone";
import { useT } from "@/lib/i18n";
import { supabase } from "@/lib/supabase/browser";
import type { Store } from "./BackOffice";

export default function SettingsTab({ store, shipping, promos, onSignOut }: {
  store: Store;
  shipping: ShippingMethod[];
  promos: PromoCode[];
  onSignOut: () => void;
}) {
  const { t, lang, setLang } = useT();
  const router = useRouter();
  const [name, setName] = useState(store.name);
  const [city, setCity] = useState(store.city ?? "");
  const [whatsapp, setWhatsapp] = useState(store.whatsapp ? displayPhone(store.whatsapp) : "");
  const [cod, setCod] = useState(store.cod_enabled);
  const [card, setCard] = useState(store.card_enabled);
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
        card_enabled: card,
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
        <Toggle label={t("settings.card")} hint={t("settings.cardSoon")} checked={card} onChange={setCard} />
        <Toggle label={t("settings.credit")} checked={credit} onChange={setCredit} />
      </fieldset>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={state === "busy"} className="ui-btn ui-btn-primary h-10 px-5">
          {t("settings.save")}
        </button>
        {state === "saved" && <span className="text-sm text-ok">{t("settings.saved")}</span>}
        {state === "error" && <span className="text-sm text-danger">{t("common.error")}</span>}
      </div>

      <Delivery store={store} methods={shipping} />
      <Promos store={store} codes={promos} />

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
      <p className="mt-6 text-center text-xs text-ink-3">{t("settings.dataCredit")}</p>
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

const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

// Delivery methods: each field saves when the merchant leaves it; a new one is added at the end.
function Delivery({ store, methods }: { store: Store; methods: ShippingMethod[] }) {
  const { t } = useT();
  const router = useRouter();
  const [error, setError] = useState(false);
  const [draft, setDraft] = useState({ name: "", price: "", free: "", days: "" });
  const money = store.currency === "EUR" ? "€" : "DH";

  const run = async (fn: () => PromiseLike<{ error: unknown }>) => {
    setError(false);
    const { error } = await fn();
    if (error) setError(true);
    else router.refresh();
    return !error;
  };
  const update = (id: string, patch: Partial<ShippingMethod>) => void run(() => supabase().from("shipping_methods").update(patch).eq("id", id));
  const add = async () => {
    const price = num(draft.price);
    if (!draft.name.trim() || price == null) return;
    const done = await run(() =>
      supabase()
        .from("shipping_methods")
        .insert({ store_id: store.id, name: draft.name.trim(), price, free_over: num(draft.free), delay_days: num(draft.days), position: methods.length }),
    );
    if (done) setDraft({ name: "", price: "", free: "", days: "" });
  };
  const cell = "ui-input h-9 px-2 text-[14px] tabular-nums";

  return (
    <section className="ui-card p-4">
      <p className="text-sm font-medium">{t("settings.shipping")}</p>
      <p className="mt-0.5 text-xs text-ink-3">{t("settings.shippingHint")}</p>
      {methods.length === 0 && <p className="mt-3 text-sm text-ink-2">{t("settings.shipNone")}</p>}
      <ul className="mt-3 flex flex-col gap-3">
        {methods.map((m) => (
          <li key={m.id} className={`flex flex-col gap-2 border-b border-line pb-3 ${m.active ? "" : "opacity-60"}`}>
            <div className="flex items-center gap-2">
              <input
                className={`${cell} flex-1`}
                defaultValue={m.name}
                aria-label={t("settings.shipName")}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== m.name) update(m.id, { name: v });
                }}
              />
              <button
                type="button"
                onClick={() => update(m.id, { active: !m.active })}
                className={`rounded px-2 py-1 text-[11px] font-medium ${m.active ? "bg-ok/15 text-ok" : "bg-soft text-ink-2"}`}
              >
                {m.active ? t("settings.active") : t("settings.paused")}
              </button>
              <button type="button" onClick={() => void run(() => supabase().from("shipping_methods").delete().eq("id", m.id))} className="text-[12px] text-danger">
                {t("settings.delete")}
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 text-[11px] text-ink-3">
              <label>
                {t("settings.shipPrice")} ({money})
                <input
                  className={cell}
                  inputMode="decimal"
                  defaultValue={m.price}
                  onBlur={(e) => {
                    const v = num(e.target.value);
                    if (v != null && v !== m.price) update(m.id, { price: v });
                  }}
                />
              </label>
              <label>
                {t("settings.shipFree")} ({money})
                <input
                  className={cell}
                  inputMode="decimal"
                  defaultValue={m.free_over ?? ""}
                  onBlur={(e) => {
                    const v = num(e.target.value);
                    if (v !== m.free_over) update(m.id, { free_over: v });
                  }}
                />
              </label>
              <label>
                {t("settings.shipDays")}
                <input
                  className={cell}
                  inputMode="numeric"
                  defaultValue={m.delay_days ?? ""}
                  onBlur={(e) => {
                    const v = num(e.target.value);
                    if (v !== m.delay_days) update(m.id, { delay_days: v });
                  }}
                />
              </label>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <input className={`${cell} col-span-2 sm:col-span-1`} placeholder={t("settings.shipName")} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <input className={cell} placeholder={`${t("settings.shipPrice")} (${money})`} inputMode="decimal" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
        <input className={cell} placeholder={`${t("settings.shipFree")} (${money})`} inputMode="decimal" value={draft.free} onChange={(e) => setDraft({ ...draft, free: e.target.value })} />
        <input className={cell} placeholder={t("settings.shipDays")} inputMode="numeric" value={draft.days} onChange={(e) => setDraft({ ...draft, days: e.target.value })} />
      </div>
      <button type="button" onClick={() => void add()} disabled={!draft.name.trim() || num(draft.price) == null} className="ui-btn ui-btn-secondary mt-2 h-9 px-3 text-[13px]">
        {t("settings.shipAdd")}
      </button>
      {error && <p className="mt-2 text-sm text-danger">{t("common.error")}</p>}
    </section>
  );
}

// Promotion codes: a list with on/off, and a line to create one (percentage or amount).
function Promos({ store, codes }: { store: Store; codes: PromoCode[] }) {
  const { t } = useT();
  const router = useRouter();
  const [error, setError] = useState(false);
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<"percent" | "amount">("percent");
  const [value, setValue] = useState("");
  const [min, setMin] = useState("");
  const money = store.currency === "EUR" ? "€" : "DH";

  const run = async (fn: () => PromiseLike<{ error: unknown }>) => {
    setError(false);
    const { error } = await fn();
    if (error) setError(true);
    else router.refresh();
    return !error;
  };
  const clean = code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  const amount = num(value) ?? 0;
  const ok = clean.length >= 3 && amount > 0 && (kind === "amount" || amount <= 90);
  const create = async () => {
    const done = await run(() => supabase().from("promo_codes").insert({ store_id: store.id, code: clean, kind, value: amount, min_subtotal: num(min) ?? 0 }));
    if (done) {
      setCode("");
      setValue("");
      setMin("");
    }
  };
  const cell = "ui-input h-9 px-2 text-[14px]";

  return (
    <section className="ui-card p-4">
      <p className="text-sm font-medium">{t("settings.promos")}</p>
      <p className="mt-0.5 text-xs text-ink-3">{t("settings.promosHint")}</p>
      {codes.length === 0 && <p className="mt-3 text-sm text-ink-2">{t("settings.promoNone")}</p>}
      <ul className="mt-2 divide-y divide-line">
        {codes.map((c) => (
          <li key={c.id} className={`flex items-center gap-3 py-2.5 text-sm ${c.active ? "" : "opacity-60"}`}>
            <span className="rounded bg-soft px-2 py-1 font-mono text-[13px] font-semibold">{c.code}</span>
            <span className="min-w-0 flex-1 text-ink-2">
              -{c.kind === "percent" ? `${c.value} %` : `${c.value} ${money}`}
              {c.min_subtotal > 0 ? ` · min ${c.min_subtotal} ${money}` : ""}
              <span className="block text-xs text-ink-3">
                {t("settings.promoUsed")} {c.uses}×
              </span>
            </span>
            <button
              type="button"
              onClick={() => void run(() => supabase().from("promo_codes").update({ active: !c.active }).eq("id", c.id))}
              className={`rounded px-2 py-1 text-[11px] font-medium ${c.active ? "bg-ok/15 text-ok" : "bg-soft text-ink-2"}`}
            >
              {c.active ? t("settings.active") : t("settings.paused")}
            </button>
            <button type="button" onClick={() => void run(() => supabase().from("promo_codes").delete().eq("id", c.id))} className="text-[12px] text-danger">
              {t("settings.delete")}
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <input className={`${cell} col-span-2 font-mono uppercase`} placeholder={t("settings.promoCode")} value={code} onChange={(e) => setCode(e.target.value)} maxLength={20} />
        <div className="flex gap-1">
          <input className={`${cell} tabular-nums`} placeholder={t("settings.promoValue")} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          <select className={`${cell} w-16`} value={kind} onChange={(e) => setKind(e.target.value as "percent" | "amount")} aria-label={t("settings.promoValue")}>
            <option value="percent">%</option>
            <option value="amount">{money}</option>
          </select>
        </div>
        <input className={`${cell} tabular-nums`} placeholder={`${t("settings.promoMin")} (${money})`} inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} />
      </div>
      <button type="button" disabled={!ok} onClick={() => void create()} className="ui-btn ui-btn-secondary mt-2 h-9 px-3 text-[13px]">
        {t("settings.promoAdd")}
      </button>
      {error && <p className="mt-2 text-sm text-danger">{t("common.error")}</p>}
    </section>
  );
}
