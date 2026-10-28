// Cart items from the browser, checked before they reach quote_cart or place_order.

export type CartItem = { product_id: string; quantity: number; color_id: string | null; size: string | null };

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Items as the database functions take them, or null when the shape is wrong.
export function cleanItems(items: unknown) {
  if (!Array.isArray(items) || items.length > 50) return null;
  const out: CartItem[] = [];
  for (const i of items as Partial<CartItem>[]) {
    if (!i || typeof i.product_id !== "string" || !UUID.test(i.product_id) || !Number.isInteger(i.quantity)) return null;
    if (i.color_id != null && (typeof i.color_id !== "string" || !UUID.test(i.color_id))) return null;
    if (i.size != null && (typeof i.size !== "string" || i.size.length > 20)) return null;
    out.push({ product_id: i.product_id, quantity: i.quantity!, color_id: i.color_id ?? null, size: i.size ?? null });
  }
  return out;
}
