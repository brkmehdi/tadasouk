"use client";

// Products: every filmed product, drafts first saved by the camera. Tap one to edit it, put it
// online or take it off. Putting a first product online also puts the store online.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatPrice } from "@/app/capture/ProductCard";
import { addPhoto, makeCover, removePhoto } from "@/lib/catalog/photos";
import { coverOf, mediaUrl, photosOf, type CatalogProduct } from "@/lib/catalog/types";
import { useT } from "@/lib/i18n";
import { supabase } from "@/lib/supabase/browser";
import type { Store } from "./BackOffice";

type Filter = "all" | "draft" | "published";

export async function setOnline(store: Store, ids: string[], online: boolean) {
  const db = supabase();
  const { error } = await db.from("products").update({ status: online ? "published" : "draft" }).in("id", ids);
  if (error) throw error;
  if (online && !store.published) await db.from("stores").update({ published: true }).eq("id", store.id);
}

export default function ProductsTab({ store, products }: { store: Store; products: CatalogProduct[] }) {
  const { t } = useT();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const shown = filter === "all" ? products : products.filter((p) => p.status === filter);
  const drafts = products.filter((p) => p.status === "draft");
  const open = products.find((p) => p.id === openId) ?? null;

  const publishAll = async () => {
    setBusy(true);
    try {
      await setOnline(store, drafts.map((p) => p.id), true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-2">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold tracking-[-0.01em]">{t("products.title")}</h1>
        <span className="text-sm text-ink-3 tabular-nums">{products.length}</span>
        {drafts.length > 0 && (
          <button type="button" onClick={() => void publishAll()} disabled={busy} className="ui-btn ui-btn-secondary ms-auto h-8 px-3 text-[13px]">
            {t("products.publishAll")}
          </button>
        )}
      </div>

      <div className="mt-3 flex gap-2 text-[13px]" role="tablist">
        {(
          [
            ["all", `${t("nav.products")}`],
            ["draft", t("products.draft")],
            ["published", t("products.online")],
          ] as const
        ).map(([f, label]) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 ${filter === f ? "bg-ink text-white" : "bg-soft text-ink-2"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {products.length === 0 ? (
        <p className="mt-8 text-sm text-ink-3">{t("products.empty")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {shown.map((p) => {
            const cover = coverOf(p);
            return (
              <li key={p.id}>
                <button type="button" onClick={() => setOpenId(p.id)} className="flex w-full items-center gap-3 py-3 text-start">
                  <span className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-white ring-1 ring-line">
                    {cover && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cover} alt="" className="h-full w-full object-contain" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{p.name || t("products.noName")}</span>
                    <span className="block text-sm text-ink-3 tabular-nums">
                      {p.price != null ? formatPrice(p.price, store.currency) : t("products.noPrice")}
                      {p.stock != null ? ` · ${t("products.stock")} ${p.stock}` : ""}
                    </span>
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                      p.status === "published" ? "bg-ok/15 text-ok" : "bg-soft text-ink-2"
                    }`}
                  >
                    {p.status === "published" ? t("products.online") : t("products.draft")}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {open && <ProductEditor key={open.id} store={store} p={open} onClose={() => setOpenId(null)} />}
    </section>
  );
}

function ProductEditor({ store, p, onClose }: { store: Store; p: CatalogProduct; onClose: () => void }) {
  const { t } = useT();
  const router = useRouter();
  const [name, setName] = useState(p.name);
  const [price, setPrice] = useState(p.price != null ? String(p.price) : "");
  const [stock, setStock] = useState(p.stock != null ? String(p.stock) : "");
  const [description, setDescription] = useState(p.description ?? "");
  const [state, setState] = useState<"idle" | "busy" | "saved" | "error">("idle");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const online = p.status === "published";

  const run = async (fn: () => Promise<void>, close = false) => {
    setState("busy");
    try {
      await fn();
      setState("saved");
      router.refresh();
      if (close) onClose();
    } catch {
      setState("error");
    }
  };

  const save = () =>
    run(async () => {
      const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
      const { error } = await supabase()
        .from("products")
        .update({ name: name.trim(), price: num(price), stock: num(stock), description: description.trim() || null })
        .eq("id", p.id);
      if (error) throw error;
    });

  return (
    <div className="fixed inset-0 z-40">
      <div className="ui-scrim" onClick={onClose} />
      <div className="ui-sheet-up absolute inset-x-0 bottom-0 mx-auto max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_-12px_40px_rgba(0,0,0,.25)]">
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 truncate text-base font-medium">{p.name || t("products.noName")}</p>
          <button type="button" onClick={onClose} aria-label={t("common.close")} className="flex h-8 w-8 items-center justify-center rounded-full bg-soft">
            ✕
          </button>
        </div>

        <Photos store={store} p={p} />

        <div className="mt-4 flex flex-col gap-3">
          <label className="block">
            <span className="ui-label">{t("products.name")}</span>
            <input className="ui-input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="ui-label">
                {t("products.price")} ({store.currency === "EUR" ? "€" : "DH"})
              </span>
              <input className="ui-input tabular-nums" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />
            </label>
            <label className="block">
              <span className="ui-label">{t("products.stock")}</span>
              <input className="ui-input tabular-nums" value={stock} onChange={(e) => setStock(e.target.value)} inputMode="numeric" />
            </label>
          </div>
          <label className="block">
            <span className="ui-label">{t("products.description")}</span>
            <textarea className="ui-input min-h-24 py-2" value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button type="button" onClick={() => void save()} disabled={state === "busy"} className="ui-btn ui-btn-secondary h-10 px-4">
            {t("products.save")}
          </button>
          {state === "saved" && <span className="text-sm text-ok">{t("products.saved")}</span>}
          {state === "error" && <span className="text-sm text-danger">{t("common.error")}</span>}
        </div>

        <button
          type="button"
          onClick={() => void run(() => setOnline(store, [p.id], !online))}
          disabled={state === "busy"}
          className={`ui-btn mt-4 h-11 w-full ${online ? "ui-btn-secondary" : "ui-btn-primary"}`}
        >
          {online ? t("products.unpublish") : t("products.publish")}
        </button>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <a href={`/${store.slug}/${p.id}`} target="_blank" rel="noopener" className="ui-btn ui-btn-secondary h-10">
            {t("products.preview")}
          </a>
          {online ? (
            <a
              href={`https://wa.me/?text=${encodeURIComponent(
                `${p.name}${p.price != null ? ` · ${formatPrice(p.price, store.currency)}` : ""}\n${location.origin}/${store.slug}/${p.id}`,
              )}`}
              target="_blank"
              rel="noopener"
              className="ui-btn ui-btn-secondary h-10"
            >
              {t("products.share")}
            </a>
          ) : (
            <span className="flex items-center text-xs text-ink-3">{t("products.shareDraft")}</span>
          )}
        </div>

        <div className="mt-3 flex justify-center">
          {confirmDelete ? (
            <div className="flex items-center gap-3 text-sm">
              <span className="text-ink-2">{t("products.deleteConfirm")}</span>
              <button
                type="button"
                className="font-medium text-danger"
                onClick={() =>
                  void run(async () => {
                    const { error } = await supabase().from("products").delete().eq("id", p.id);
                    if (error) throw error;
                  }, true)
                }
              >
                {t("products.delete")}
              </button>
              <button type="button" className="text-ink-3" onClick={() => setConfirmDelete(false)}>
                {t("common.cancel")}
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className="ui-btn h-9 text-[13px] text-danger hover:bg-soft">
              {t("products.delete")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Photos of a saved product: tap one to make it the cover or remove it; "+ Photo" takes a new one
// (the phone offers its camera or its gallery).
function Photos({ store, p }: { store: Store; p: CatalogProduct }) {
  const { t } = useT();
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const photos = photosOf(p);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(false);
    try {
      await fn();
      setSelected(null);
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3">
      <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5">
        {photos.map((img, i) => (
          <button
            key={img.id}
            type="button"
            onClick={() => setSelected(selected === img.id ? null : img.id)}
            className={`relative h-[84px] w-[84px] shrink-0 overflow-hidden rounded-md bg-white ${
              selected === img.id ? "ring-2 ring-brand" : i === 0 ? "ring-2 ring-ink/80" : "ring-1 ring-line"
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mediaUrl(img.r2_key)} alt="" className="h-full w-full object-contain" />
            {i === 0 && <span className="ui-badge absolute start-1 bottom-1">{t("products.isCover")}</span>}
          </button>
        ))}
        <label
          className={`flex h-[84px] w-[84px] shrink-0 cursor-pointer items-center justify-center rounded-md bg-soft text-sm font-medium text-ink-2 ${busy ? "opacity-50" : ""}`}
        >
          {busy ? "…" : t("products.addPhoto")}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void run(() => addPhoto(store.id, p, file));
            }}
          />
        </label>
      </div>
      {selected && (
        <div className="mt-2 flex gap-2">
          {photos[0]?.id !== selected && (
            <button type="button" disabled={busy} onClick={() => void run(() => makeCover(p, selected))} className="ui-btn ui-btn-secondary h-9 px-3 text-[13px]">
              {t("products.makeCover")}
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => void run(() => removePhoto(selected))} className="ui-btn h-9 px-3 text-[13px] text-danger hover:bg-soft">
            {t("products.removePhoto")}
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-danger">{t("common.error")}</p>}
    </div>
  );
}
