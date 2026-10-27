// Live capture session state and the reducer that applies the agent's tool calls.
// Everything here runs in the browser; the server only sees a compact copy per agent call.

export type ProductImage = {
  id: string;
  url: string;
  // camera: real photo on white; studio: real pixels on an AI backdrop; ai: generated from web references
  source: "camera" | "studio" | "ai";
  pending: boolean; // camera: SAM cutout not back yet, url is the instant crop
  cutoutUrl?: string; // camera: transparent cutout, input of the studio photo
};

export type PriceCheck =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "done";
      currency: string;
      low: number | null;
      average: number | null;
      high: number | null;
      suggested: number | null;
      name_fr?: string;
      name_ar?: string;
      description_fr?: string;
      category?: string;
      verdict: "cheap" | "fair" | "expensive" | "unknown";
      note: string;
      sources: { title: string; url: string; price: number | null }[];
    };

export type Product = {
  id: string;
  order: number;
  name: string | null; // set by the merchant (or accepted from the suggestion)
  // What the AI proposes; shown as a draft until the merchant uses it ("Tout utiliser").
  suggested: { name: string | null; description: string | null };
  nameAr: string | null;
  category: string | null;
  identify: "idle" | "loading" | "done" | "failed"; // AI naming from the photo
  research: "idle" | "running" | "done"; // studio photos, web photos, prices once the product is done
  label: string | null; // what the on-device detector called it, e.g. "bottle"
  color: string | null; // dominant color of the cutout, for "the red one"
  images: ProductImage[]; // first one is the cover
  description: string | null;
  price: number | null;
  compareAtPrice: number | null;
  currency: string;
  quantity: number | null;
  question: string | null;
  status: "active" | "failed" | "removing";
  photos: "idle" | "loading" | "error"; // AI studio photos
  priceCheck: PriceCheck | null;
  capturedAt: number;
};

export type SessionState = {
  currency: string;
  products: Product[];
  currentId: string | null;
  history: Product[][];
};

export type ToolCall = { name: string; args: Record<string, unknown> };

// Calls the browser runs after applying the state change (they need network and time).
export type Effect = { kind: "better_photos" | "check_price" | "next_product"; productId: string };

export type Applied = { state: SessionState; question: string | null; changed: boolean; effects: Effect[] };

export function initialSession(currency = "MAD"): SessionState {
  return { currency, products: [], currentId: null, history: [] };
}

export function visible(state: SessionState) {
  return state.products.filter((p) => p.status !== "removing");
}

export function cover(p: Product) {
  return p.images[0] ?? null;
}

export function displayName(p: Product) {
  return p.name ?? p.suggested.name ?? (p.label ? p.label[0].toUpperCase() + p.label.slice(1) : "Produit");
}

// Suggestions the merchant has not taken yet (empty when everything is already in use).
export function pendingSuggestions(p: Product) {
  const price = suggestedPrice(p);
  return {
    name: p.suggested.name && p.suggested.name !== p.name ? p.suggested.name : null,
    description: p.suggested.description && p.suggested.description !== p.description ? p.suggested.description : null,
    price: price != null && price !== p.price ? price : null,
  };
}

export function hasSuggestions(p: Product) {
  const s = pendingSuggestions(p);
  return s.name != null || s.description != null || s.price != null;
}

// "Tout utiliser": take every pending suggestion at once.
export function suggestionPatch(p: Product): Partial<Product> {
  const s = pendingSuggestions(p);
  return {
    ...(s.name != null ? { name: s.name } : {}),
    ...(s.description != null ? { description: s.description } : {}),
    ...(s.price != null ? { price: s.price, compareAtPrice: null } : {}),
  };
}

export function suggestedPrice(p: Product) {
  return p.priceCheck?.status === "done" ? p.priceCheck.suggested : null;
}

export type Question = { productId: string; text: string; action?: { label: string; patch: Partial<Product> } };

// The one thing to ask the merchant next about a product, most important first.
export function nextQuestion(p: Product): Question | null {
  if (p.status !== "active" || p.images.some((i) => i.pending) || p.identify === "loading") return null;
  const name = displayName(p);
  if (p.price == null) {
    const s = suggestedPrice(p);
    return s != null
      ? {
          productId: p.id,
          text: `Prix de « ${name} » ? Conseillé : ${s} ${p.currency === "EUR" ? "€" : "DH"}`,
          action: { label: `Mettre ${s}`, patch: { price: s, compareAtPrice: null } },
        }
      : { productId: p.id, text: `Quel est le prix de « ${name} » ?` };
  }
  if (!p.name && !p.suggested.name) return { productId: p.id, text: "Comment s’appelle ce produit ?" };
  if (p.quantity == null) return { productId: p.id, text: `Combien de « ${name} » avez-vous ?` };
  return null;
}

// Compact copy of the state for the agent: ids, names, prices, and capture order.
export function agentView(state: SessionState) {
  const list = visible(state).sort((a, b) => a.order - b.order);
  return {
    currency: state.currency,
    currentId: state.currentId,
    recent: list.slice(-5).map((p) => p.id),
    products: list.map((p) => ({
      id: p.id,
      name: p.name,
      suggestedName: p.suggested.name,
      label: p.label,
      color: p.color,
      price: p.price,
      compareAtPrice: p.compareAtPrice,
      quantity: p.quantity,
      description: p.description,
      photos: p.images.length,
      suggestedPrice: suggestedPrice(p),
    })),
    openQuestion: (() => {
      const cur = list.find((p) => p.id === state.currentId);
      const q = cur ? nextQuestion(cur) : null;
      return q ? { productId: q.productId, text: q.text } : null;
    })(),
  };
}

function nextOrder(state: SessionState) {
  return state.products.reduce((m, x) => Math.max(m, x.order), 0) + 1;
}

function blank(state: SessionState, id: string): Product {
  return {
    id,
    order: nextOrder(state),
    name: null,
    suggested: { name: null, description: null },
    nameAr: null,
    category: null,
    identify: "idle",
    research: "idle",
    label: null,
    color: null,
    images: [],
    description: null,
    price: null,
    compareAtPrice: null,
    currency: state.currency,
    quantity: null,
    question: null,
    status: "active",
    photos: "idle",
    priceCheck: null,
    capturedAt: Date.now(),
  };
}

// Saves the current products so the next change can be undone.
function snapshot(state: SessionState): SessionState {
  return { ...state, history: [...state.history.slice(-30), state.products] };
}

export function addCaptured(
  state: SessionState,
  p: { id: string; imageId: string; label: string | null; ghostUrl: string },
): SessionState {
  const product: Product = {
    ...blank(state, p.id),
    label: p.label,
    images: [{ id: p.imageId, url: p.ghostUrl, source: "camera", pending: true }],
  };
  const s = snapshot(state);
  return { ...s, products: [...s.products, product], currentId: product.id };
}

export function patchProduct(state: SessionState, id: string, patch: Partial<Product>): SessionState {
  return { ...state, products: state.products.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
}

// A merchant edit from the product sheet: undoable like a voice command.
export function editProduct(state: SessionState, id: string, patch: Partial<Product>): SessionState {
  return patchProduct(snapshot(state), id, { ...patch, question: null });
}

export function addImage(state: SessionState, productId: string, image: ProductImage): SessionState {
  return mapProduct(state, productId, (p) => ({ ...p, images: [...p.images, image] }));
}

export function patchImage(
  state: SessionState,
  productId: string,
  imageId: string,
  patch: Partial<ProductImage>,
): SessionState {
  return mapProduct(state, productId, (p) => ({
    ...p,
    images: p.images.map((i) => (i.id === imageId ? { ...i, ...patch } : i)),
  }));
}

export function dropImage(state: SessionState, productId: string, imageId: string): SessionState {
  return mapProduct(state, productId, (p) => ({ ...p, images: p.images.filter((i) => i.id !== imageId) }));
}

export function makeCover(state: SessionState, productId: string, imageId: string): SessionState {
  return mapProduct(state, productId, (p) => {
    const img = p.images.find((i) => i.id === imageId);
    return img ? { ...p, images: [img, ...p.images.filter((i) => i !== img)] } : p;
  });
}

export function removeProduct(state: SessionState, id: string): SessionState {
  let s = patchProduct(snapshot(state), id, { status: "removing" });
  if (s.currentId === id) s = { ...s, currentId: visible(s).sort((a, b) => a.order - b.order).at(-1)?.id ?? null };
  return s;
}

function mapProduct(state: SessionState, id: string, fn: (p: Product) => Product): SessionState {
  return { ...state, products: state.products.map((p) => (p.id === id ? fn(p) : p)) };
}

// Undo restores prices, names and descriptions, not the photos and checks that arrived since.
function undo(state: SessionState): SessionState {
  const prev = state.history.at(-1);
  if (!prev) return state;
  const products = prev.map((old) => {
    const now = state.products.find((p) => p.id === old.id);
    if (!now) return old;
    return {
      ...old,
      images: now.images,
      color: now.color,
      label: now.label,
      photos: now.photos,
      priceCheck: now.priceCheck,
      identify: now.identify,
      research: now.research,
      nameAr: now.nameAr,
      suggested: now.suggested,
      category: now.category,
      status: now.status === "removing" ? "active" : now.status,
    } satisfies Product;
  });
  const currentId = products.some((p) => p.id === state.currentId) ? state.currentId : (products.at(-1)?.id ?? null);
  return { ...state, products, currentId, history: state.history.slice(0, -1) };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" ? Number(v) : NaN);
const round2 = (v: number) => Math.round(v * 100) / 100;

export function applyCalls(state: SessionState, calls: ToolCall[], newId: () => string): Applied {
  let s = state;
  let question: string | null = null;
  let changed = false;
  const effects: Effect[] = [];
  const before = state.products;

  const find = (args: Record<string, unknown>) => {
    const id = typeof args.product_id === "string" ? args.product_id : s.currentId;
    return s.products.find((p) => p.id === id && p.status !== "removing") ?? null;
  };
  const update = (id: string, patch: Partial<Product>) => {
    s = patchProduct(s, id, { ...patch, question: null });
    changed = true;
  };

  for (const { name, args } of calls) {
    if (name === "undo_last") {
      s = undo(s);
      continue;
    }
    if (name === "create_product") {
      const id = newId();
      const price = num(args.price);
      const qty = num(args.quantity);
      s = {
        ...s,
        currentId: id,
        products: [
          ...s.products,
          {
            ...blank(s, id),
            name: String(args.name ?? "") || null,
            price: Number.isFinite(price) ? round2(price) : null,
            quantity: Number.isFinite(qty) ? Math.max(0, Math.round(qty)) : null,
          },
        ],
      };
      changed = true;
      continue;
    }
    if (name === "next_product") {
      effects.push({ kind: "next_product", productId: s.currentId ?? "" });
      continue;
    }
    if (name === "ask_merchant") {
      question = String(args.question ?? "") || "?";
      const p = find(args);
      if (p) s = patchProduct(s, p.id, { question });
      continue;
    }

    const p = find(args);
    if (!p) continue;
    if (name === "set_price") {
      const amount = num(args.amount);
      if (!(amount >= 0)) continue;
      const currency = args.currency === "EUR" || args.currency === "MAD" ? args.currency : p.currency;
      update(p.id, { price: round2(amount), compareAtPrice: null, currency });
    } else if (name === "apply_discount") {
      const value = num(args.value);
      const base = p.compareAtPrice ?? p.price;
      if (base == null || !(value > 0)) {
        s = patchProduct(s, p.id, { question: "?" });
        question = question ?? "Quel est le prix avant la remise ?";
        continue;
      }
      const next = args.kind === "percent" ? base * (1 - Math.min(value, 100) / 100) : base - value;
      update(p.id, { price: round2(Math.max(0, next)), compareAtPrice: base });
    } else if (name === "rename_product") {
      const n = String(args.name ?? "").trim();
      if (n) update(p.id, { name: n });
    } else if (name === "set_description") {
      const d = String(args.description ?? "").trim();
      if (d) update(p.id, { description: d });
    } else if (name === "set_quantity") {
      const q = num(args.quantity);
      if (q >= 0) update(p.id, { quantity: Math.round(q) });
    } else if (name === "remove_product") {
      update(p.id, { status: "removing" });
      if (s.currentId === p.id) {
        const rest = visible(s).sort((a, b) => a.order - b.order);
        s = { ...s, currentId: rest.at(-1)?.id ?? null };
      }
    } else if (name === "find_better_photos") {
      effects.push({ kind: "better_photos", productId: p.id });
    } else if (name === "check_price") {
      effects.push({ kind: "check_price", productId: p.id });
    } else if (name === "accept_suggestions") {
      const patch = suggestionPatch(p);
      if (Object.keys(patch).length) update(p.id, patch);
    }
  }

  if (changed) s = { ...s, history: [...s.history.slice(-30), before] };
  return { state: s, question, changed, effects };
}

// Products marked "removing" leave the DOM after their exit animation.
export function purgeRemoved(state: SessionState): SessionState {
  return { ...state, products: state.products.filter((p) => p.status !== "removing") };
}
