// Orders as the back office reads them (supabase/migrations: orders, order_items).

export type Order = {
  id: string;
  number: number;
  status: "pending" | "confirmed" | "shipped" | "delivered" | "cancelled";
  payment_method: "cod" | "card" | "card_counter" | "cash" | "credit";
  payment_status: "unpaid" | "partial" | "paid" | "refunded";
  total: number;
  currency: string;
  customer_name: string | null;
  customer_phone: string | null;
  city: string | null;
  address: string | null;
  note: string | null;
  created_at: string;
  order_items: { name: string; unit_price: number; quantity: number }[];
};

export const ORDER_COLUMNS =
  "id, number, status, payment_method, payment_status, total, currency, customer_name, customer_phone, city, address, note, created_at, order_items(name, unit_price, quantity)";
