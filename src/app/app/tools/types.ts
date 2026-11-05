// The merchant tools opened from the Home tab, each full screen over the back office.
// Each tool reads and writes with the merchant's own session (row level security), or through
// its own API route, and calls onChanged() after a write so the back office reloads its data.

import type { Order } from "@/lib/catalog/orders";
import type { CatalogProduct } from "@/lib/catalog/types";
import type { Store } from "../BackOffice";

export type ToolId = "credit" | "stockcam" | "qrpay" | "ads" | "market" | "seo";

export type ToolProps = {
  store: Store;
  products: CatalogProduct[];
  orders: Order[];
  onExit: () => void;
  onChanged: () => void;
};
