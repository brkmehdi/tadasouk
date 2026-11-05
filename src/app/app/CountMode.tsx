"use client";

// Counting the stock from shelf photos. The merchant photographs a shelf (or picks a photo), the
// AI finds the store's products on it (/api/count), each item gets a numbered dot. A wrong dot is
// removed by a tap, a count is fixed with − and +, more shelves can be added, and nothing changes
// in the store until "Update the stock".

import { useMemo, useRef, useState } from "react";
import { catalogGrid, countCells, MAX_CELLS, shelfJpeg, type CountCell, type CountItem } from "@/lib/catalog/count";
import { colorsOf, coverOf, type CatalogProduct } from "@/lib/catalog/types";
import { useT } from "@/lib/i18n";
import { supabase } from "@/lib/supabase/browser";

type Shot = { url: string; ratio: number; cells: CountCell[]; items: (CountItem & { off: boolean })[] };
type Phase = "start" | "working" | "result" | "saved";

const DOTS = ["#e5484d", "#30a46c", "#3e63dd", "#f76b15", "#8e4ec6", "#12a594", "#d6409f", "#978365", "#0090ff", "#e54666"];

export default function CountMode({
  products,
  onExit,
  onSaved,
}: {
  products: CatalogProduct[];
  onExit: () => void;
  onSaved: () => void;
}) {
  const { t } = useT();
  const [sessionId] = useState(() => crypto.randomUUID());
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<{ key: string; url: string } | null>(null);
  const [phase, setPhase] = useState<Phase>("start");
  const [category, setCategory] = useState<string | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [fix, setFix] = useState<Record<string, number>>({}); // − and + on top of the dots
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const allCells = useMemo(() => countCells(products), [products]);
  const categoryOf = (c: CountCell) => byId.get(c.productId)?.category?.trim() || null;
  const categories = [...new Set(allCells.map(categoryOf).filter((c): c is string => !!c))].sort();
  const choose = allCells.length > MAX_CELLS && categories.length > 1;
  const chosen = category ? allCells.filter((c) => categoryOf(c) === category) : allCells;
  const cells: CountCell[] = chosen.slice(0, MAX_CELLS);
  const withoutPhoto = products.filter((p) => p.status !== "archived" && p.product_images.length === 0).length;

  // Products seen on the photos, in the order they were first seen (their number and dot colour
  // stay put); colours listed under each. A product whose dots were all removed is not counted.
  // `missed`: its colours no photo looked for, so the number shown may be short of the real stock.
  const seen = useMemo(() => {
    const order = new Map<string, number>(); // id -> dots still on
    const colors = new Map<string, Map<string, number>>();
    for (const s of shots)
      for (const it of s.items) {
        if (!order.has(it.productId)) order.set(it.productId, 0);
        if (it.off) continue;
        order.set(it.productId, order.get(it.productId)! + 1);
        if (it.colorId) {
          const m = colors.get(it.productId) ?? new Map<string, number>();
          m.set(it.colorId, (m.get(it.colorId) ?? 0) + 1);
          colors.set(it.productId, m);
        }
      }
    return [...order].flatMap(([id, dots], i) => {
      const p = byId.get(id);
      if (!p) return [];
      const count = Math.max(0, dots + (fix[id] ?? 0));
      const byColor = [...(colors.get(id) ?? [])].map(([cid, k]) => {
        const c = p.product_colors.find((x) => x.id === cid);
        return { id: cid, name: c?.name ?? "?", hex: c?.hex ?? "#8b8d98", k };
      });
      const missed = colorsOf(p).filter((c) => !shots.some((s) => s.cells.some((x) => x.productId === id && x.colorId === c.id)));
      return [{ p, dots, count, byColor, missed, color: DOTS[i % DOTS.length], no: i + 1, counted: dots > 0 || (fix[id] ?? 0) > 0 }];
    });
  }, [shots, fix, byId]);
  const rows = seen.filter((r) => r.counted);
  const rowOf = (id: string) => seen.find((r) => r.p.id === id);

  const analyse = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    const previewUrl = URL.createObjectURL(file);
    setPreview(previewUrl);
    setPhase("working");
    try {
      const shelf = await shelfJpeg(file);
      const key = cells.map((c) => c.url).join("|");
      if (gridRef.current?.key !== key) gridRef.current = { key, url: await catalogGrid(cells) };
      const res = await fetch("/api/count", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          shelf: shelf.url,
          grid: gridRef.current.url,
          cells: cells.map((c) => ({ productId: c.productId, colorId: c.colorId })),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { items?: CountItem[]; message?: string };
      if (!res.ok || !data.items) throw new Error(data.message ?? t("common.error"));
      setShots((s) => [...s, { url: shelf.url, ratio: shelf.height / shelf.width, cells, items: data.items!.map((it) => ({ ...it, off: false })) }]);
      setPhase("result");
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t("common.error"));
      setPhase(shots.length ? "result" : "start");
    } finally {
      setPreview(null);
      URL.revokeObjectURL(previewUrl);
    }
  };

  // The − corrections can never exceed the dots left, or + would look dead and a dot put back would not count.
  const toggle = (shot: number, item: number) => {
    const it = shots[shot].items[item];
    const dots = (rowOf(it.productId)?.dots ?? 0) + (it.off ? 1 : -1);
    setShots((s) => s.map((x, i) => (i !== shot ? x : { ...x, items: x.items.map((y, j) => (j === item ? { ...y, off: !y.off } : y)) })));
    setFix((f) => ({ ...f, [it.productId]: Math.max(f[it.productId] ?? 0, -dots) }));
  };

  // Each stock is set to its count, so saving again after a failure is safe.
  const save = async () => {
    setSaving(true);
    setError(null);
    const db = supabase();
    const results = await Promise.all(
      rows.map(async (r) => {
        const { data, error: e } = await db.from("products").update({ stock: r.count }).eq("id", r.p.id).select("id");
        return !e && (data?.length ?? 0) > 0;
      }),
    );
    setSaving(false);
    const failed = rows.filter((_, i) => !results[i]);
    if (failed.length) {
      setError(`${t("count.saveFailed")} ${failed.map((r) => r.p.name || t("products.noName")).join(", ")}`);
      if (failed.length < rows.length) onSaved();
      return;
    }
    setPhase("saved");
    onSaved();
  };

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    void analyse(e.target.files?.[0]);
    e.target.value = ""; // the same photo picked again still counts
  };
  const categoryChips = [null, ...categories].map((c) => (
    <button
      key={c ?? "all"}
      type="button"
      onClick={() => setCategory(c)}
      aria-pressed={category === c}
      className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium ${category === c ? "bg-ink text-white" : "bg-soft text-ink-2"}`}
    >
      {c ?? t("count.all")}
    </button>
  ));
  const pickers = (
    <>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <input ref={galleryRef} type="file" accept="image/*" hidden data-testid="count-gallery" onChange={pick} />
    </>
  );

  return (
    <div className="flex h-dvh flex-col bg-white text-ink">
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <h1 className="flex-1 text-base font-semibold">{t("count.open")}</h1>
        <button type="button" onClick={onExit} className="ui-btn ui-btn-soft h-9 px-3 text-sm">
          {t("common.close")}
        </button>
      </header>
      {pickers}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{error}</p>}

        {phase === "start" && (
          <div className="mx-auto max-w-md">
            {allCells.length === 0 ? (
              <p className="text-sm text-ink-2">{t("count.empty")}</p>
            ) : (
              <>
                <p className="text-sm text-ink-2">{t("count.intro")}</p>
                {choose && (
                  <>
                    <p className="ui-label mt-5">{t("count.which")}</p>
                    <div className="flex flex-wrap gap-2">{categoryChips}</div>
                  </>
                )}
                {chosen.length > MAX_CELLS && <p className="mt-3 text-xs text-ink-3">{t("count.firstOnly")}</p>}
                <CellStrip cells={cells} />
                {withoutPhoto > 0 && <p className="mt-2 text-xs text-ink-3">{t("count.noPhoto")}</p>}
                <button type="button" onClick={() => cameraRef.current?.click()} className="ui-btn ui-btn-primary mt-6 h-12 w-full text-base">
                  {t("count.camera")}
                </button>
                <button type="button" onClick={() => galleryRef.current?.click()} className="ui-btn ui-btn-secondary mt-2 h-11 w-full">
                  {t("count.gallery")}
                </button>
              </>
            )}
          </div>
        )}

        {phase === "working" && preview && (
          <div className="mx-auto max-w-md">
            <div className="relative overflow-hidden rounded-lg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="" className="w-full" />
              <div className="count-scan absolute inset-0" aria-hidden />
            </div>
            <p className="mt-4 text-center text-base font-medium" role="status">
              {t("count.working")}
            </p>
            <p className="text-center text-xs text-ink-3">{t("count.workingHint")}</p>
          </div>
        )}

        {(phase === "result" || phase === "saved") && (
          <div className="mx-auto max-w-md">
            {shots.map((s, si) => (
              <div key={si} className="relative mb-3 overflow-hidden rounded-lg bg-soft" style={{ aspectRatio: `1 / ${s.ratio}` }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.url} alt="" className="absolute inset-0 h-full w-full" />
                {s.items.map((it, ii) => {
                  const r = rowOf(it.productId);
                  // A colour of a product shows in its own swatch, so the colours read apart.
                  const hex = it.colorId ? r?.p.product_colors.find((c) => c.id === it.colorId)?.hex : null;
                  return (
                    <button
                      key={ii}
                      type="button"
                      disabled={phase === "saved"}
                      onClick={() => toggle(si, ii)}
                      aria-label={`${r?.p.name ?? ""} ${ii + 1}`}
                      data-dot={it.off ? "off" : "on"}
                      className="absolute flex h-[22px] w-[22px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[10px] font-bold text-white shadow ring-2 ring-white transition-opacity [text-shadow:0_0_2px_rgba(0,0,0,0.6)]"
                      style={{
                        left: `${(it.x + it.w / 2) * 100}%`,
                        top: `${(it.y + it.h / 2) * 100}%`,
                        background: it.off ? "#8b8d98" : (hex ?? r?.color),
                        opacity: it.off ? 0.55 : 1,
                      }}
                    >
                      {it.off ? "×" : r?.no}
                    </button>
                  );
                })}
              </div>
            ))}
            {shots.at(-1)?.items.length === 0 && <p className="mb-3 text-sm text-ink-3">{t("count.none")}</p>}
            {phase === "result" && rows.length > 0 && <p className="text-xs text-ink-3">{t("count.tapDot")}</p>}

            {rows.length > 0 && (
              <>
                <h2 className="mt-4 text-sm font-semibold">{phase === "saved" ? t("count.saved") : t("count.found")}</h2>
                <ul className="mt-2 divide-y divide-line" data-testid="count-rows">
                  {rows.map((r) => {
                    const img = coverOf(r.p);
                    return (
                      <li key={r.p.id} className="flex items-center gap-3 py-2.5">
                        <span className="relative shrink-0">
                          {img ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={img} alt="" className="h-11 w-11 rounded object-contain ring-1 ring-black/10" />
                          ) : (
                            <span className="block h-11 w-11 rounded bg-soft" />
                          )}
                          <span
                            className="absolute -top-1.5 -left-1.5 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white ring-2 ring-white"
                            style={{ background: r.color }}
                          >
                            {r.no}
                          </span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span dir="auto" className="block truncate text-sm font-medium">
                            {r.p.name || t("products.noName")}
                          </span>
                          {r.byColor.length > 0 && (
                            <span className="mt-0.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-xs text-ink-2">
                              {r.byColor.map((c) => (
                                <span key={c.id} className="inline-flex items-center gap-1 tabular-nums">
                                  <span className="h-2.5 w-2.5 rounded-full ring-1 ring-black/10" style={{ background: c.hex }} />
                                  {c.name} {c.k}
                                </span>
                              ))}
                            </span>
                          )}
                          <span className="block text-xs text-ink-3 tabular-nums">
                            {t("count.stockNow")} {r.p.stock ?? "—"}
                          </span>
                          {phase === "result" && r.missed.length > 0 && (
                            <span className="mt-0.5 block text-xs font-medium text-danger" data-testid="count-missed">
                              {t("count.missed")} {r.missed.map((c) => c.name).join(", ")}. {t("count.missedHint")}
                            </span>
                          )}
                        </span>
                        {phase === "result" ? (
                          <span className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setFix((f) => ({ ...f, [r.p.id]: (f[r.p.id] ?? 0) - 1 }))}
                              disabled={r.count === 0}
                              className="ui-btn ui-btn-soft h-8 w-8 p-0"
                              aria-label="−"
                            >
                              −
                            </button>
                            <span className="w-7 text-center text-base font-semibold tabular-nums" data-testid="count-n">
                              {r.count}
                            </span>
                            <button
                              type="button"
                              onClick={() => setFix((f) => ({ ...f, [r.p.id]: (f[r.p.id] ?? 0) + 1 }))}
                              className="ui-btn ui-btn-soft h-8 w-8 p-0"
                              aria-label="+"
                            >
                              +
                            </button>
                          </span>
                        ) : (
                          <span className="text-base font-semibold text-ok tabular-nums">{r.count}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        )}
      </div>

      {phase === "result" && (
        <div className="shrink-0 border-t border-line px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-md">
            {rows.length > 0 && <p className="mb-2 text-xs text-ink-3">{t("count.saveHint")}</p>}
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || rows.length === 0}
              className="ui-btn ui-btn-primary h-12 w-full text-base"
            >
              {t("count.save")}
            </button>
            {choose && (
              <>
                <p className="mt-3 text-xs text-ink-3">{t("count.whichNext")}</p>
                <div className="no-scrollbar mt-1.5 flex gap-2 overflow-x-auto pb-0.5">{categoryChips}</div>
              </>
            )}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => cameraRef.current?.click()} className="ui-btn ui-btn-secondary h-10 text-[13px]">
                {t("count.another")}
              </button>
              <button type="button" onClick={() => galleryRef.current?.click()} className="ui-btn ui-btn-secondary h-10 text-[13px]">
                {t("count.gallery")}
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === "saved" && (
        <div className="shrink-0 border-t border-line px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button type="button" onClick={onExit} className="ui-btn ui-btn-primary mx-auto flex h-12 w-full max-w-md text-base">
            {t("count.done")}
          </button>
        </div>
      )}
    </div>
  );
}

// The photos the AI will look for, so the merchant sees what will be counted.
function CellStrip({ cells }: { cells: CountCell[] }) {
  return (
    <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto pb-1">
      {cells.map((c) => (
        <span key={c.url} className="w-14 shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={c.url} alt="" className="h-14 w-14 rounded-md bg-white object-contain ring-1 ring-black/10" />
          {c.colorName && <span className="mt-0.5 block truncate text-center text-[10px] text-ink-3">{c.colorName}</span>}
        </span>
      ))}
    </div>
  );
}
