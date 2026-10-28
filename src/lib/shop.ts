// The public store's shared shapes, used by the server pages and the browser alike.

export type ShopColor = { id: string; name: string; hex: string; cover: string | null };

export type ShopProduct = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  categorySlug: string | null;
  price: number | null;
  compareAt: number | null; // only when higher than the price
  cover: string | null;
  colors: ShopColor[];
  sizes: string[];
  soldout: string[]; // "<colour id or empty>:<size or empty>"
  inStock: boolean;
  draft: boolean; // seen by the merchant only, in the preview
  createdAt: string;
};

export type ShippingOption = { id: string; name: string; price: number; free_over: number | null; delay_days: number | null };

export type ShopCategory = { name: string; slug: string; count: number; cover: string | null };

// "Thé & Infusions" -> "the-infusions"
export function categorySlug(name: string) {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9؀-ۿ]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "autres"
  );
}

// Categories in the order of their number of products, each with the photo of its newest one.
export function categoriesOf(products: ShopProduct[]): ShopCategory[] {
  const by = new Map<string, ShopCategory>();
  for (const p of products) {
    if (!p.category || !p.categorySlug) continue;
    const c = by.get(p.categorySlug) ?? { name: p.category, slug: p.categorySlug, count: 0, cover: null };
    c.count++;
    c.cover ??= p.cover;
    by.set(p.categorySlug, c);
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "fr"));
}

export const hasOptions = (p: ShopProduct) => p.colors.length > 0 || p.sizes.length > 0;
export const isSoldOut = (p: ShopProduct, colorId: string | null, size: string | null) =>
  p.soldout.includes(`${colorId ?? ""}:${size ?? ""}`);
export const pctOff = (p: ShopProduct) => (p.compareAt && p.price != null ? Math.round((1 - p.price / p.compareAt) * 100) : 0);

// The cheapest delivery threshold: "free delivery from X" in the banner and the cart.
export const freeFrom = (methods: ShippingOption[]) =>
  methods.reduce<number | null>((m, s) => (s.free_over != null && (m == null || s.free_over < m) ? s.free_over : m), null);

export const delayText = (days: number | null) =>
  days == null ? null : days === 0 ? "le jour même" : days === 1 ? "24 h" : `${days} jours`;

// The cart as the database priced it (quote_cart).
export type QuoteLine = {
  product_id: string;
  color_id: string | null;
  color: string | null;
  size: string | null;
  name: string;
  unit_price: number | null;
  quantity: number;
  image: string | null;
  ok: boolean;
};
export type Quote = {
  lines: QuoteLine[];
  subtotal: number;
  discount: number;
  promo_code: string | null;
  promo_error: "unknown" | "expired" | "used_up" | "minimum" | null;
  shipping: { id: string; name: string; fee: number } | null;
  shipping_options: (ShippingOption & { fee: number })[];
  total: number;
  currency: string;
};

export const PROMO_ERRORS: Record<NonNullable<Quote["promo_error"]>, string> = {
  unknown: "Ce code n'existe pas.",
  expired: "Ce code a expiré.",
  used_up: "Ce code a déjà été utilisé autant de fois que prévu.",
  minimum: "Le panier n'atteint pas le minimum de ce code.",
};
