"use client";

// A sales video becomes products. The merchant picks a video from the phone; the products are found
// in it the way the camera finds them (scanProducts), and what is said names them and gives their
// prices; the merchant keeps, corrects or removes each one and can touch the product on the frame.
// Only confirmed products cost anything more: they then go through the same steps as a filmed product.
// Items the seller offers together for one price are shown as one pack, with what it holds; the
// merchant can take an item out of a pack or put one in.
// A video can also come from the merchant's own Instagram (InstagramVideos): it is then read the same way.

import { useEffect, useRef, useState } from "react";
import type { Keyframe } from "@/lib/capture/cutout";
import {
  contactSheet,
  listen,
  MAX_BYTES,
  MAX_SECONDS,
  productFrame,
  recognise,
  sameName,
  scanProducts,
  sharpestFrame,
  type Found,
} from "@/lib/catalog/video";
import { useT } from "@/lib/i18n";
import type { ImportedProduct } from "@/app/capture/CaptureScreen";
import InstagramVideos from "./InstagramVideos";

// `views`: other sides of the product, like extra shots. Null for a product only the speech named:
// they are then taken around its moment when it is added. `pack`: the id of the pack it is sold in.
type Item = Omit<Found, "price"> & {
  id: string;
  price: string;
  keep: boolean;
  picture: string;
  frame: Keyframe;
  views: Keyframe[] | null;
  found: string;
  pack: string | null;
};
// One product in the shop, whose description lists its items.
type Pack = { id: string; name: string; price: string; keep: boolean };
// The review list: a product on its own, or a pack with its items (indexes into the items).
type Entry = { item: number } | { pack: Pack; items: number[] };
const VIEW_STEP = 2; // seconds before and after a named product's moment
const NEAR = 2; // seconds: a name said this close to a product on screen is its name

const OPEN_TIMEOUT_MS = 20_000;
const PACK_VIEWS = 5; // photos of a pack's items besides its main one

// The AI sometimes writes the price in the pack's name: "Pack maquillage 200 DH".
const PRICE_IN_NAME = /\s*[-:]?\s*(\d+(?:[.,]\d+)?)\s*(?:dhs?|mad|درهم)\.?\s*$/iu;

const amount = (text: string) => {
  const v = Number(text.trim().replace(",", "."));
  return text.trim() && Number.isFinite(v) ? v : null;
};

// The seller names the items, then says the price of the lot: a pack costs the highest price heard.
const highest = (prices: string[]) => {
  const top = Math.max(-1, ...prices.map((p) => amount(p) ?? -1));
  return top < 0 ? "" : String(top);
};

// A pack of one item is that item alone, at the pack's price if it had none.
function tidy(items: Item[], packs: Pack[]): [Item[], Pack[]] {
  const lone = packs.filter((k) => items.filter((x) => x.pack === k.id).length < 2);
  if (!lone.length) return [items, packs];
  const next = items.map((x) => {
    const k = lone.find((l) => l.id === x.pack);
    return k ? { ...x, pack: null, price: x.price || k.price } : x;
  });
  return [next, packs.filter((k) => !lone.includes(k))];
}

function entriesOf(items: Item[], packs: Pack[]): Entry[] {
  const entries: Entry[] = [];
  items.forEach((x, i) => {
    const pack = x.pack ? packs.find((k) => k.id === x.pack) : undefined;
    if (!pack) return entries.push({ item: i });
    const open = entries.find((e) => "pack" in e && e.pack.id === pack.id);
    if (open && "pack" in open) open.items.push(i);
    else entries.push({ pack, items: [i] });
  });
  return entries;
}

type Phase = "start" | "fetching" | "listening" | "scanning" | "reading" | "framing" | "review" | "empty";

export default function VideoImport({
  currency,
  instagram,
  onExit,
  onAdd,
}: {
  currency: string;
  instagram?: string | null; // what Meta's login said, when the merchant just came back from it
  onExit: () => void;
  onAdd: (items: ImportedProduct[]) => void;
}) {
  const { t } = useT();
  const [sessionId] = useState(() => crypto.randomUUID());
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>("start");
  const [progress, setProgress] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [error, setError] = useState<string | null>(() =>
    !instagram || instagram === "connected"
      ? null
      : t(instagram === "no_account" ? "insta.noAccount" : instagram === "cancelled" ? "insta.cancelled" : "insta.failed"),
  );
  const urlRef = useRef<string | null>(null);
  const closedRef = useRef(false);

  useEffect(() => {
    closedRef.current = false;
    return () => {
      closedRef.current = true;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  // The video comes through our server, then is read on the phone like one of its own.
  const fromInstagram = async (id: string) => {
    setError(null);
    setPhase("fetching");
    try {
      const res = await fetch(`/api/instagram/video?id=${id}`);
      if (!res.ok) return fail(t("insta.failed"));
      const blob = await res.blob();
      if (closedRef.current) return;
      await analyse(new File([blob], "instagram.mp4", { type: blob.type || "video/mp4" }));
    } catch {
      fail(t("insta.failed"));
    }
  };

  const fail = (message: string) => {
    setError(message);
    setPhase("start");
  };

  const open = (video: HTMLVideoElement, file: File) =>
    new Promise<boolean>((resolve) => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(file);
      setTimeout(() => resolve(false), OPEN_TIMEOUT_MS);
      video.onloadeddata = () => resolve(true);
      video.onerror = () => resolve(false);
      video.src = urlRef.current;
      video.load();
    });

  const analyse = async (file: File | undefined) => {
    const video = videoRef.current;
    if (!file || !video) return;
    setError(null);
    if (file.size > MAX_BYTES) return fail(t("video.tooBig"));
    setPhase("listening");
    setProgress(0);
    try {
      if (!(await open(video, file))) return fail(t("video.unreadable"));
      if (video.duration > MAX_SECONDS) return fail(t("video.tooLong"));
      const seconds = video.duration;
      const spoken = await listen(sessionId, file, setProgress, () => closedRef.current);
      if (closedRef.current) return;
      setPhase("scanning");
      setProgress(0);
      const shots = await scanProducts(video, setProgress, () => closedRef.current);
      if (closedRef.current) return;
      setPhase("reading");
      const scanned = await recognise(sessionId, shots, spoken);
      const sheet = await contactSheet(video);
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, spoken, sheet, currency, seconds }),
      });
      const data = (await res.json().catch(() => ({}))) as { products?: Found[]; message?: string };
      if ((!res.ok || !data.products) && !scanned.length) return fail(data.message ?? t("common.error"));
      setPhase("framing");
      const found: Item[] = scanned.map((s) => ({
        id: crypto.randomUUID(),
        pack: null,
        name: s.name,
        found: s.name,
        price: "",
        at: s.from,
        keep: s.sure, // what the AI could not name is shown unticked: often the table or the floor
        frame: s.frame,
        views: s.views,
        picture: s.frame.canvas.toDataURL("image/jpeg", 0.7),
      }));
      // Each name said goes to the product on screen when it was said; one said over nothing
      // the camera would have taken still becomes a product, at that moment of the video.
      const said = new Set<number>();
      for (const p of data.products ?? []) {
        const gaps = scanned.map((s, i) => ({ i, gap: p.at < s.from ? s.from - p.at : p.at > s.to ? p.at - s.to : 0 }));
        const near = gaps.filter((x) => x.gap <= NEAR && !said.has(x.i)).sort((a, b) => a.gap - b.gap)[0];
        const price = p.price == null ? "" : String(p.price);
        // Said while a product already named is on screen, as each item of a pack: still that product.
        const within = gaps.find((x) => x.gap === 0 && said.has(x.i));
        if (!near && within) {
          if (!found[within.i].price) found[within.i].price = price;
          continue;
        }
        // A name already on the list is that product again, read elsewhere in the video.
        const twin = near ? -1 : found.findIndex((x) => x.keep && x.name && sameName(x.name, p.name));
        if (twin >= 0) {
          if (!found[twin].price) found[twin].price = price;
          continue;
        }
        if (near) {
          said.add(near.i);
          // A name read on the product beats one heard; the price is the one said.
          if (!scanned[near.i].sure) Object.assign(found[near.i], { name: p.name, found: p.name, keep: true });
          found[near.i].price = price;
          continue;
        }
        await sharpestFrame(video, p.at);
        const frame = productFrame(video);
        found.push({
          ...p,
          id: crypto.randomUUID(),
          pack: null,
          price,
          keep: true,
          frame,
          views: null,
          found: p.name,
          picture: frame.canvas.toDataURL("image/jpeg", 0.7),
        });
      }
      if (!found.length) return setPhase("empty");
      // Items the AI saw sold together, under one pack name.
      const named = new Map<string, Pack>();
      scanned.forEach((s, i) => {
        if (!s.pack || !found[i].keep) return;
        const key = s.pack.toLowerCase();
        if (!named.has(key)) named.set(key, { id: crypto.randomUUID(), name: s.pack, price: "", keep: true });
        found[i].pack = named.get(key)!.id;
      });
      const grouped = [...named.values()].map((k) => {
        const written = k.name.match(PRICE_IN_NAME);
        return {
          ...k,
          name: written ? k.name.replace(PRICE_IN_NAME, "") : k.name,
          price: written ? written[1].replace(",", ".") : highest(found.filter((x) => x.pack === k.id).map((x) => x.price)),
        };
      });
      regroup(
        found.sort((a, b) => a.at - b.at),
        grouped,
      );
      setPhase("review");
    } catch (e) {
      fail(e instanceof Error && e.message ? e.message : t("common.error"));
    }
  };

  const change = (i: number, patch: Partial<Item>) => setItems((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const changePack = (id: string, patch: Partial<Pack>) => setPacks((l) => l.map((k) => (k.id === id ? { ...k, ...patch } : k)));
  function regroup(nextItems: Item[], nextPacks: Pack[]) {
    const [a, b] = tidy(nextItems, nextPacks);
    setItems(a);
    setPacks(b);
  }
  const takeOut = (i: number) => regroup(items.map((x, j) => (j === i ? { ...x, pack: null } : x)), packs);
  // The item goes into a pack next to it, or makes a pack with the product above it.
  const joinWith = (next: Entry, i: number) => {
    if ("pack" in next) return regroup(items.map((x, j) => (j === i ? { ...x, pack: next.pack.id } : x)), packs);
    const pack: Pack = { id: crypto.randomUUID(), name: "", price: highest([items[next.item].price, items[i].price]), keep: true };
    regroup(items.map((x, j) => (j === i || j === next.item ? { ...x, pack: pack.id } : x)), [...packs, pack]);
  };
  const entries = entriesOf(items, packs);
  const isKept = (e: Entry | undefined): e is Entry => !!e && ("pack" in e ? e.pack.keep : items[e.item].keep);
  // A lot shown item by item comes out as products at one price. So does a shop where everything
  // costs the same: the merchant says which with one tap.
  const loose = entries.flatMap((e) => ("item" in e && items[e.item].keep ? [e.item] : []));
  const onePrice = loose.length >= 3 && items[loose[0]].price && loose.every((i) => items[i].price === items[loose[0]].price) ? items[loose[0]].price : null;
  const packAll = () => {
    const pack: Pack = { id: crypto.randomUUID(), name: "", price: onePrice ?? "", keep: true };
    regroup(items.map((x, j) => (loose.includes(j) ? { ...x, pack: pack.id } : x)), [...packs, pack]);
  };

  // A touch on the picture says where the product is; the AI then finds its edges from there.
  const touch = (i: number, e: React.MouseEvent<HTMLImageElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const { canvas, box } = items[i].frame;
    const point = { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height };
    const moved = { ...box, x: point.x - box.w / 2, y: point.y - box.h / 2 };
    change(i, { frame: { ...items[i].frame, point, box: moved } });
  };

  const kept = entries.filter((e) => ("pack" in e ? e.pack.keep : items[e.item].keep));
  const add = async () => {
    const video = videoRef.current;
    setPhase("framing");
    const added: ImportedProduct[] = [];
    for (const e of kept) {
      // A pack: one photo of each item, and the list of them as its description.
      if ("pack" in e) {
        const members = e.items.map((i) => items[i]);
        const names = members.map((x) => x.name.trim()).filter(Boolean);
        added.push({
          frame: members[0].frame,
          views: members.slice(1, 1 + PACK_VIEWS).map((x) => x.frame),
          // Left unnamed: "Pack" and its first items, which the merchant can rename later.
          name: e.pack.name.trim() || `${t("video.pack")} ${names.slice(0, 3).join(", ")}${names.length > 3 ? "…" : ""}`,
          named: true,
          price: amount(e.pack.price),
          contents: names.length ? `${t("video.packHolds")} ${names.join(", ")}.` : null,
        });
        continue;
      }
      const x = items[e.item];
      const views: Keyframe[] = x.views ?? [];
      for (const at of video && !x.views ? [x.at - VIEW_STEP, x.at + VIEW_STEP].filter((s) => s > 0 && s < video.duration) : []) {
        await sharpestFrame(video!, at);
        views.push(productFrame(video!));
      }
      added.push({ frame: x.frame, views, name: x.name.trim(), named: x.name.trim() !== x.found.trim(), price: amount(x.price), contents: null });
    }
    onAdd(added);
    onExit();
  };

  const busy = phase === "fetching" || phase === "listening" || phase === "scanning" || phase === "reading" || phase === "framing";

  return (
    <div className="flex h-dvh flex-col bg-white text-ink">
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <h1 className="flex-1 text-base font-semibold">{t("video.open")}</h1>
        <button type="button" onClick={onExit} className="ui-btn ui-btn-soft h-9 px-3 text-sm">
          {t("common.close")}
        </button>
      </header>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        hidden
        data-testid="video-file"
        onChange={(e) => {
          void analyse(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {/* Not display:none: Safari may then never load it. */}
      <video ref={videoRef} muted playsInline preload="auto" className="pointer-events-none absolute h-px w-px opacity-0" />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-md">
          {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{error}</p>}

          {phase === "start" && (
            <>
              <p className="text-sm text-ink-2">{t("video.intro")}</p>
              <p className="mt-2 text-xs text-ink-3">{t("video.limits")}</p>
              <button type="button" onClick={() => inputRef.current?.click()} className="ui-btn ui-btn-primary mt-6 h-12 w-full text-base">
                {t("video.choose")}
              </button>

              <InstagramVideos onPick={(id) => void fromInstagram(id)} />
            </>
          )}

          {busy && (
            <div className="py-10 text-center" role="status">
              <p className="text-base font-medium">
                {phase === "fetching"
                  ? t("insta.fetching")
                  : phase === "listening"
                    ? t("video.listening")
                    : phase === "scanning"
                      ? t("video.scanning")
                      : phase === "reading"
                        ? t("video.reading")
                        : t("video.framing")}
              </p>
              {(phase === "listening" || phase === "scanning") && progress > 0 && (
                <p className="mt-1 text-sm text-ink-3 tabular-nums">{Math.round(progress * 100)} %</p>
              )}
              <p className="mt-1 text-xs text-ink-3">{t("video.stay")}</p>
            </div>
          )}

          {phase === "empty" && (
            <>
              <p className="text-sm text-ink-2">{t("video.none")}</p>
              <button type="button" onClick={() => inputRef.current?.click()} className="ui-btn ui-btn-secondary mt-4 h-11 w-full">
                {t("video.choose")}
              </button>
            </>
          )}

          {phase === "review" && (
            <>
              <p className="text-sm text-ink-2">{t("video.check")}</p>
              {onePrice && (
                <p className="mt-3 rounded-md bg-soft px-3 py-2 text-sm text-ink-2">
                  {t("video.samePrice")}{" "}
                  <button type="button" onClick={packAll} className="font-medium text-ink underline">
                    {t("video.packAll")}
                  </button>
                </p>
              )}
              <ul className="mt-3 space-y-4" data-testid="video-items">
                {entries.map((entry, n) => {
                  const above = isKept(entries[n - 1]) ? entries[n - 1] : null;
                  const below = isKept(entries[n + 1]) && "pack" in entries[n + 1] ? entries[n + 1] : null;
                  // A pack next to the item comes first; else a new pack with the product above.
                  const join = above && "pack" in above ? above : (below ?? above);
                  if ("pack" in entry) {
                    const k = entry.pack;
                    return (
                      <li key={k.id} data-pack className={`rounded-lg border border-line p-3 ${k.keep ? "" : "opacity-45"}`}>
                        <p className="text-xs font-semibold text-ink-3">
                          {t("video.pack")} · {entry.items.length}
                        </p>
                        <input
                          dir="auto"
                          value={k.name}
                          placeholder={t("video.packName")}
                          onChange={(e) => changePack(k.id, { name: e.target.value })}
                          aria-label={t("video.packName")}
                          className="ui-input mt-2 h-10 w-full text-sm"
                        />
                        <span className="mt-2 flex items-center gap-2">
                          <input
                            inputMode="decimal"
                            value={k.price}
                            placeholder={t("video.price")}
                            onChange={(e) => changePack(k.id, { price: e.target.value })}
                            aria-label={t("video.price")}
                            className="ui-input h-10 w-24 text-sm"
                          />
                          <span className="text-xs text-ink-3">{currency}</span>
                          <button type="button" onClick={() => changePack(k.id, { keep: !k.keep })} className="ui-btn ui-btn-soft ms-auto h-9 px-3 text-xs">
                            {k.keep ? t("video.remove") : t("video.restore")}
                          </button>
                        </span>
                        <p className="mt-3 text-xs text-ink-3">{t("video.packItems")}</p>
                        <ul className="mt-1 space-y-2" data-testid="pack-items">
                          {entry.items.map((i) => (
                            <li key={items[i].id} className="flex items-center gap-2">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={items[i].picture} alt="" className="h-12 w-12 shrink-0 rounded-md bg-soft object-cover" />
                              <input
                                dir="auto"
                                value={items[i].name}
                                placeholder={t("video.unnamed")}
                                onChange={(e) => change(i, { name: e.target.value })}
                                aria-label={t("video.name")}
                                className="ui-input h-9 min-w-0 flex-1 text-sm"
                              />
                              <button type="button" onClick={() => takeOut(i)} className="ui-btn ui-btn-soft h-9 shrink-0 px-2 text-xs">
                                {t("video.packOut")}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </li>
                    );
                  }
                  const i = entry.item;
                  const x = items[i];
                  return (
                    <li key={x.id} className={x.keep ? "" : "opacity-45"}>
                      <span className="flex gap-3">
                        <span className="relative w-24 shrink-0 self-start overflow-hidden rounded-md bg-soft">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={x.picture} alt="" className="block w-full" onClick={(e) => touch(i, e)} />
                          {x.frame.point && (
                            <span
                              className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand ring-2 ring-white"
                              style={{
                                left: `${(x.frame.point.x / x.frame.canvas.width) * 100}%`,
                                top: `${(x.frame.point.y / x.frame.canvas.height) * 100}%`,
                              }}
                            />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <input
                            dir="auto"
                            value={x.name}
                            placeholder={t("video.unnamed")}
                            onChange={(e) => change(i, { name: e.target.value })}
                            aria-label={t("video.name")}
                            className="ui-input h-10 w-full text-sm"
                          />
                          <span className="mt-2 flex items-center gap-2">
                            <input
                              inputMode="decimal"
                              value={x.price}
                              placeholder={t("video.price")}
                              onChange={(e) => change(i, { price: e.target.value })}
                              aria-label={t("video.price")}
                              className="ui-input h-10 w-24 text-sm"
                            />
                            <span className="text-xs text-ink-3">{currency}</span>
                            <button type="button" onClick={() => change(i, { keep: !x.keep })} className="ui-btn ui-btn-soft ms-auto h-9 px-3 text-xs">
                              {x.keep ? t("video.remove") : t("video.restore")}
                            </button>
                          </span>
                        </span>
                      </span>
                      {x.keep && join && (
                        <button type="button" onClick={() => joinWith(join, i)} className="mt-1 text-xs text-ink-3 underline">
                          {join === below ? t("video.packJoinBelow") : "pack" in join ? t("video.packJoin") : t("video.packMake")}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-xs text-ink-3">{t("video.touch")}</p>
            </>
          )}
        </div>
      </div>

      {phase === "review" && (
        <div className="shrink-0 border-t border-line px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => void add()}
            disabled={!kept.length}
            className="ui-btn ui-btn-primary mx-auto flex h-12 w-full max-w-md text-base"
          >
            {t("video.add")} ({kept.length})
          </button>
        </div>
      )}
    </div>
  );
}
