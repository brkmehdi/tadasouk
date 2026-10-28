// A product in a grid: square photo on a soft ground, a badge (promotion, best seller, new),
// name and price on one row, its category under it, and its colours as small discs.

import Link from "next/link";
import { formatPrice } from "@/lib/money";
import { pctOff, type ShopProduct } from "@/lib/shop";

export function ProductCard({ p, slug, currency, badge }: { p: ShopProduct; slug: string; currency: string; badge?: string | null }) {
  const off = pctOff(p);
  const label = p.draft ? "Brouillon" : off ? `-${off} %` : badge;
  return (
    <Link href={`/${slug}/${p.id}`} className="group block">
      <span className="relative block aspect-square overflow-hidden rounded-md bg-[#f2f2f2]">
        {p.cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={p.cover}
            alt={p.name}
            loading="lazy"
            className="h-full w-full object-contain p-[6%] mix-blend-multiply transition-transform duration-300 group-hover:scale-[1.03]"
          />
        )}
        {label && (
          <span
            className={`absolute start-2 top-2 rounded px-1.5 py-0.5 text-[12px] font-medium ${
              p.draft ? "bg-ink text-white" : off ? "bg-[#d7f5e6] text-[#0a7d4e]" : "bg-white text-ink ring-1 ring-line"
            }`}
          >
            {label}
          </span>
        )}
        {!p.inStock && (
          <span className="absolute end-2 bottom-2 rounded bg-white/90 px-1.5 py-0.5 text-[12px] font-medium text-ink-2">Épuisé</span>
        )}
      </span>
      <span className="mt-2.5 flex items-start justify-between gap-2">
        <span className="min-w-0 text-[14px] font-medium leading-[18px]">{p.name}</span>
        <span className="shrink-0 text-[14px] font-medium tabular-nums tracking-[-0.02em]">
          {p.compareAt != null && <s className="me-1.5 font-normal text-ink-3">{formatPrice(p.compareAt, currency)}</s>}
          {p.price != null ? formatPrice(p.price, currency) : "Sur demande"}
        </span>
      </span>
      {p.category && <span className="mt-0.5 block text-[12px] text-ink-3">{p.category}</span>}
      {p.colors.length > 1 && (
        <span className="mt-2 flex gap-1.5" aria-label={`${p.colors.length} couleurs`}>
          {p.colors.slice(0, 6).map((c) => (
            <span key={c.id} title={c.name} className="h-3 w-3 rounded-full ring-1 ring-black/15" style={{ background: c.hex }} />
          ))}
        </span>
      )}
    </Link>
  );
}

export function ProductGrid({ products, slug, currency, cols = 4, badges }: {
  products: ShopProduct[];
  slug: string;
  currency: string;
  cols?: 3 | 4;
  badges?: Map<string, string>;
}) {
  return (
    <ul className={`grid grid-cols-2 gap-x-4 gap-y-8 sm:gap-x-6 ${cols === 4 ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
      {products.map((p) => (
        <li key={p.id}>
          <ProductCard p={p} slug={slug} currency={currency} badge={badges?.get(p.id)} />
        </li>
      ))}
    </ul>
  );
}
