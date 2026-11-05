// Delivery partners for an order, the steps of a shipment, and where Morocco's main cities sit
// on the stylised map. Partner names are generic on purpose (no partnership is signed yet):
// rename them, or change a fee, here only. Usable on the server and in the browser.

export type DeliveryKind = "local" | "intercity";
export type ShipmentStatus = "created" | "picked_up" | "in_transit" | "delivered" | "failed";
export type ShipmentEvent = { status: ShipmentStatus; at: string };

export type Shipment = {
  id: string;
  order_id: string;
  partner: string;
  kind: DeliveryKind;
  fee: number;
  from_city: string | null;
  to_city: string | null;
  tracking: string;
  status: ShipmentStatus;
  events: ShipmentEvent[];
  created_at: string;
};

export const SHIPMENT_COLUMNS = "id, order_id, partner, kind, fee, from_city, to_city, tracking, status, events, created_at";

// Same city: a courier on a scooter, today. Another city: a parcel network, 24 to 48 h.
// `fee` is per store currency.
export const PARTNERS: Record<
  DeliveryKind,
  { name: { fr: string; en: string }; delay: { fr: string; en: string }; fee: { MAD: number; EUR: number } }
> = {
  local: {
    name: { fr: "Coursier local", en: "Local courier" },
    delay: { fr: "Livré aujourd'hui", en: "Delivered today" },
    fee: { MAD: 25, EUR: 3 },
  },
  intercity: {
    name: { fr: "Messagerie inter-villes", en: "Intercity parcel" },
    delay: { fr: "Livré en 24 à 48 h", en: "Delivered in 24 to 48 h" },
    fee: { MAD: 40, EUR: 5 },
  },
};

export function partnerFee(kind: DeliveryKind, currency: string) {
  return PARTNERS[kind].fee[currency === "EUR" ? "EUR" : "MAD"];
}

// The steps the customer sees, in order ("failed" is outside the happy path).
export const STEPS: { status: ShipmentStatus; fr: string; en: string }[] = [
  { status: "created", fr: "Prête à partir", en: "Ready to go" },
  { status: "picked_up", fr: "Récupérée par le livreur", en: "Picked up by the courier" },
  { status: "in_transit", fr: "En route", en: "On the way" },
  { status: "delivered", fr: "Livrée", en: "Delivered" },
];

export function stepIndex(status: ShipmentStatus) {
  return Math.max(0, STEPS.findIndex((s) => s.status === status));
}

export function nextStatus(status: ShipmentStatus): ShipmentStatus | null {
  const i = STEPS.findIndex((s) => s.status === status);
  return i >= 0 && i < STEPS.length - 1 ? STEPS[i + 1].status : null;
}

// "SS-7K2P9Q": six characters without the look-alikes (0/O, 1/I/L).
export function trackingCode() {
  const abc = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `SS-${Array.from(bytes, (b) => abc[b % abc.length]).join("")}`;
}

export const TRACKING_RE = /^SS-[A-Z0-9]{6}$/;

// ---- cities ----

// Approximate positions on the map's 345 x 270 canvas: x = (longitude + 14) x 26 + 10,
// y = (36.2 - latitude) x 26 + 12.
export const CITIES: { name: string; x: number; y: number; aliases: string[] }[] = [
  { name: "Tanger", x: 223, y: 23, aliases: ["tanger", "tangier", "tanja", "tangiers"] },
  { name: "Tétouan", x: 234, y: 28, aliases: ["tetouan", "tetuan", "titwan"] },
  { name: "Oujda", x: 324, y: 52, aliases: ["oujda", "wajda"] },
  { name: "Kénitra", x: 203, y: 62, aliases: ["kenitra", "knitra"] },
  { name: "Rabat", x: 196, y: 69, aliases: ["rabat", "sale", "temara"] },
  { name: "Meknès", x: 230, y: 72, aliases: ["meknes", "meknas", "miknas"] },
  { name: "Fès", x: 244, y: 68, aliases: ["fes", "fez", "fas"] },
  { name: "Casablanca", x: 177, y: 80, aliases: ["casablanca", "casa", "dar el beida", "dar beida", "mohammedia"] },
  { name: "El Jadida", x: 153, y: 89, aliases: ["el jadida", "eljadida", "jadida"] },
  { name: "Safi", x: 134, y: 113, aliases: ["safi", "asfi"] },
  { name: "Marrakech", x: 166, y: 131, aliases: ["marrakech", "marrakesh", "marrakch", "mraksh"] },
  { name: "Agadir", x: 124, y: 162, aliases: ["agadir", "inezgane"] },
  { name: "Laâyoune", x: 31, y: 247, aliases: ["laayoune", "layoune", "el aaiun", "laayoun", "aaiun"] },
];

export function normCity(s: string | null | undefined) {
  return (s ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function findCity(s: string | null | undefined) {
  const n = normCity(s);
  if (!n) return null;
  return CITIES.find((c) => c.aliases.includes(n)) ?? CITIES.find((c) => c.aliases.some((a) => n.startsWith(a))) ?? null;
}

// Same city (by name, or both matching the same map city) means a local delivery.
export function deliveryKind(from: string | null, to: string | null): DeliveryKind {
  const a = normCity(from);
  const b = normCity(to);
  if (a && b && a === b) return "local";
  const ca = findCity(from);
  return ca && ca === findCity(to) ? "local" : "intercity";
}
