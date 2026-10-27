// Live capture session state and the reducer that applies the agent's tool calls.
// Everything here runs in the browser; the server only sees a compact copy per agent call.

export type Product = {
  id: string;
  order: number;
  name: string | null;
  label: string | null; // what the on-device detector called it, e.g. "bottle"
  color: string | null; // dominant color of the cutout, for "the red one"
  cutoutUrl: string | null;
  ghostUrl: string | null; // instant crop shown while SAM works
  price: number | null;
  compareAtPrice: number | null;
  currency: string;
  quantity: number | null;
  question: string | null;
  status: "segmenting" | "ready" | "failed" | "removing";
  capturedAt: number;
};

export type SessionState = {
  currency: string;
  products: Product[];
  currentId: string | null;
  history: Product[][];
};

export type ToolCall = { name: string; args: Record<string, unknown> };

export type Applied = { state: SessionState; question: string | null; changed: boolean };

export function initialSession(currency = "MAD"): SessionState {
  return { currency, products: [], currentId: null, history: [] };
}

export function visible(state: SessionState) {
  return state.products.filter((p) => p.status !== "removing");
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
      label: p.label,
      color: p.color,
      price: p.price,
      compareAtPrice: p.compareAtPrice,
      quantity: p.quantity,
    })),
  };
}

export function addCaptured(
  state: SessionState,
  p: Pick<Product, "id" | "label" | "ghostUrl" | "capturedAt">,
): SessionState {
  const order = state.products.reduce((m, x) => Math.max(m, x.order), 0) + 1;
  const product: Product = {
    ...p,
    order,
    name: null,
    color: null,
    cutoutUrl: null,
    price: null,
    compareAtPrice: null,
    currency: state.currency,
    quantity: null,
    question: null,
    status: "segmenting",
  };
  return {
    ...state,
    history: [...state.history, state.products],
    products: [...state.products, product],
    currentId: product.id,
  };
}

export function patchProduct(state: SessionState, id: string, patch: Partial<Product>): SessionState {
  return { ...state, products: state.products.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" ? Number(v) : NaN);
const round2 = (v: number) => Math.round(v * 100) / 100;

export function applyCalls(state: SessionState, calls: ToolCall[], newId: () => string): Applied {
  let s = state;
  let question: string | null = null;
  let changed = false;
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
      const prev = s.history.at(-1)?.map((old) => {
        // Undo restores prices and names, not the cutout that SAM delivered since.
        const now = s.products.find((p) => p.id === old.id);
        if (!now) return old;
        const status = now.status === "removing" ? (now.cutoutUrl ? "ready" : old.status) : now.status;
        return { ...old, cutoutUrl: now.cutoutUrl, color: now.color, label: now.label, status };
      });
      if (prev) {
        s = { ...s, products: prev, history: s.history.slice(0, -1) };
        if (!prev.some((p) => p.id === s.currentId)) s.currentId = prev.at(-1)?.id ?? null;
      }
      continue;
    }
    if (name === "create_product") {
      const id = newId();
      const order = s.products.reduce((m, x) => Math.max(m, x.order), 0) + 1;
      const price = num(args.price);
      const qty = num(args.quantity);
      s = {
        ...s,
        currentId: id,
        products: [
          ...s.products,
          {
            id,
            order,
            name: String(args.name ?? "") || null,
            label: null,
            color: null,
            cutoutUrl: null,
            ghostUrl: null,
            price: Number.isFinite(price) ? round2(price) : null,
            compareAtPrice: null,
            currency: s.currency,
            quantity: Number.isFinite(qty) ? Math.max(0, Math.round(qty)) : null,
            question: null,
            status: "ready",
            capturedAt: Date.now(),
          },
        ],
      };
      changed = true;
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
    } else if (name === "set_quantity") {
      const q = num(args.quantity);
      if (q >= 0) update(p.id, { quantity: Math.round(q) });
    } else if (name === "remove_product") {
      update(p.id, { status: "removing" });
      if (s.currentId === p.id) {
        const rest = visible(s).sort((a, b) => a.order - b.order);
        s.currentId = rest.at(-1)?.id ?? null;
      }
    }
  }

  if (changed) s = { ...s, history: [...s.history, before] };
  return { state: s, question, changed };
}

// Products marked "removing" leave the DOM after their exit animation.
export function purgeRemoved(state: SessionState): SessionState {
  return { ...state, products: state.products.filter((p) => p.status !== "removing") };
}
