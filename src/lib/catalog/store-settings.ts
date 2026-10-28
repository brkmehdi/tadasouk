// The store's delivery methods and promotion codes, as the back office edits them.

export type ShippingMethod = {
  id: string;
  name: string;
  price: number;
  free_over: number | null;
  delay_days: number | null;
  active: boolean;
  position: number;
};
export const SHIPPING_COLUMNS = "id, name, price, free_over, delay_days, active, position";

export type PromoCode = {
  id: string;
  code: string;
  kind: "percent" | "amount";
  value: number;
  min_subtotal: number;
  ends_at: string | null;
  max_uses: number | null;
  uses: number;
  active: boolean;
};
export const PROMO_COLUMNS = "id, code, kind, value, min_subtotal, ends_at, max_uses, uses, active";
