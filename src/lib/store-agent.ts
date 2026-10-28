// What /api/store-agent sends back to the back office: its answer, the changes it made (each
// with what it replaced, so the screen can undo it) and steps the screen does itself.

export type Undo = {
  table: "products" | "stores" | "shipping_methods" | "promo_codes" | "product_colors";
  id: string;
  before?: Record<string, unknown>; // put these values back
  remove?: true; // the row was created: delete it
};
export type AgentAction = { label: string; undo: Undo[] };
export type ClientStep = { type: "hero" } | { type: "confirm_delete"; ids: string[]; names: string[] };
export type AgentAnswer = { reply: string; actions: AgentAction[]; client: ClientStep[] };
