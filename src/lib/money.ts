// Prices as the shop shows them: "120 DH", "12.50 €". Usable on the server and in the browser.
export function formatPrice(v: number, currency: string) {
  const n = Number.isInteger(v) ? String(v) : v.toFixed(2);
  return currency === "EUR" ? `${n} €` : `${n} DH`;
}
