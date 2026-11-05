// /{slug}/llms.txt: the store in plain Markdown for AI assistants (llmstxt.org): who sells, where,
// how to order, and every published product with its price and link. Published stores only,
// even for the signed-in merchant, so the file is the same for everyone.

import { colorsOf } from "@/lib/catalog/types";
import { displayPhone } from "@/lib/phone";
import { delayText } from "@/lib/shop";
import { loadProducts, loadShipping, loadStore, siteOrigin } from "@/lib/storefront";

// Markdown special characters in names and descriptions would break the list.
const md = (s: string) => s.replace(/\s+/g, " ").replace(/([[\]*_`#<>])/g, "\\$1").trim();
const amount = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));

export async function GET(_req: Request, { params }: { params: Promise<{ store: string }> }) {
  const found = await loadStore((await params).store);
  if (!found?.store.published) return new Response("Not found\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const { store } = found;
  const [products, shipping, origin] = await Promise.all([loadProducts(store.id, false), loadShipping(store.id), siteOrigin()]);
  const cur = store.currency;
  const home = `${origin}/${store.slug}`;

  const lines: string[] = [`# ${md(store.name)}`, ""];
  lines.push(`> ${md(store.tagline || `Boutique en ligne${store.city ? ` à ${store.city}, Maroc` : " au Maroc"}.`)}`, "");
  lines.push(`Boutique : ${home}`);
  if (store.city) lines.push(`Ville : ${md(store.city)}, Maroc`);
  lines.push(`Monnaie : ${cur}`, `Produits en ligne : ${products.length}`, "");

  lines.push("## Comment commander", "");
  lines.push(`- Sur le site : choisir un produit, l'ajouter au panier, puis valider la commande (${home}/panier).`);
  if (store.cod_enabled) lines.push("- Paiement à la livraison : le client paie en espèces quand il reçoit sa commande.");
  if (store.whatsapp) lines.push(`- WhatsApp : ${displayPhone(store.whatsapp)} (https://wa.me/${store.whatsapp}), pour une question ou pour commander.`);
  for (const m of shipping) {
    const delay = delayText(m.delay_days);
    const free = m.free_over != null ? `, offerte dès ${amount(m.free_over)} ${cur}` : "";
    lines.push(`- Livraison ${md(m.name)} : ${m.price ? `${amount(m.price)} ${cur}` : "offerte"}${free}${delay ? `, ${delay}` : ""}.`);
  }
  lines.push("");

  lines.push("## Produits", "");
  if (!products.length) lines.push("Aucun produit en ligne pour le moment.");
  for (const p of products) {
    const facts = [
      p.price != null ? `${amount(p.price)} ${cur}` : "prix sur demande",
      p.category?.trim() ? md(p.category) : null,
      colorsOf(p).length ? `couleurs : ${colorsOf(p).map((c) => md(c.name)).join(", ")}` : null,
      p.sizes?.length ? `tailles : ${p.sizes.map(md).join(", ")}` : null,
      p.stock != null && p.stock <= 0 ? "épuisé" : "disponible",
    ].filter(Boolean);
    const desc = p.description ? ` ${md(p.description).slice(0, 240)}` : "";
    lines.push(`- [${md(p.name || "Produit")}](${home}/${p.id}): ${facts.join(", ")}.${desc}`);
  }
  lines.push("");

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}
