// The shared catalog: products any shop may sell, by barcode, in the D1 database CATALOG. It starts
// from the Open Facts databases (ODbL, see the catalog table's `source`), and every product the
// research finds with certainty joins it with its price range, so the next shop gets it for free.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { catalogKey, nameWords, sameItem } from "./sources";

const FRESH_DAYS = 30; // a price range older than this is searched again

export type CatalogEntry = {
  barcode: string;
  name: string;
  brand: string | null;
  quantity: string | null;
  category: string;
  image_url: string | null;
  source: string;
  price_low: number | null;
  price_high: number | null;
  price_at: number | null;
  research: string | null;
};

export async function findByBarcode(barcode: string | null | undefined) {
  const code = catalogKey(barcode);
  if (!code) return null;
  return getCloudflareContext().env.CATALOG.prepare("select * from catalog where barcode = ?").bind(code).first<CatalogEntry>();
}

// Candidates for a name: all its words first, then one word less at a time.
// Long words match on their start, so "Crémi" finds "Cremy". The inner limit caps the rows one search
// can read, which are what a free D1 account runs out of.
export async function searchCatalog(name: string, limit = 5) {
  const db = getCloudflareContext().env.CATALOG;
  const list = [...new Set(nameWords(name))].slice(0, 8);
  // One word only if the whole name is one long word, like a brand.
  const fewest = list.length === 1 && list[0].length >= 5 ? 1 : 2;
  for (let n = list.length; n >= fewest; n--) {
    const query = list
      .slice(0, n)
      .map((w) => (w.length >= 5 ? `"${w.slice(0, 4)}"*` : `"${w}"`))
      .join(" ");
    const { results } = await db
      .prepare(
        `select c.* from catalog c join
           (select barcode from catalog_search where catalog_search match ? limit 2000) s on s.barcode = c.barcode
         order by c.nearby desc, c.scans desc limit ?`,
      )
      .bind(query, limit)
      .all<CatalogEntry>();
    if (results.length) return results;
  }
  return [];
}

// What the first research found for this barcode, for the next shop, while it is recent. An entry
// holding prices alone is not reused: the product would come out poorer than the first one.
export function reusedResearch(e: CatalogEntry | null) {
  if (!e?.research || e.price_at == null || Date.now() - e.price_at >= FRESH_DAYS * 86_400_000) return null;
  try {
    return { ...(JSON.parse(e.research) as Record<string, unknown>), reused: true };
  } catch {
    return null;
  }
}

// A price only joins an entry it seems to belong to; a barcode the catalog does not know yet has
// nothing to compare with.
export async function sameProduct(barcode: string, name: string) {
  const entry = await findByBarcode(barcode);
  return !entry || sameItem(entry, name);
}

// A product the research found with certainty, for the next shop.
export async function remember(p: { barcode: string; name: string; category: string; low: number | null; high: number | null; research: object }) {
  const code = catalogKey(p.barcode);
  if (!code) return;
  await getCloudflareContext()
    .env.CATALOG.prepare(
      `insert into catalog (barcode, name, category, source, price_low, price_high, price_at, research) values (?1, ?2, ?3, 'smallstore', ?4, ?5, ?6, ?7)
       on conflict (barcode) do update set price_low = ?4, price_high = ?5, price_at = ?6, research = ?7`,
    )
    .bind(code, p.name, p.category, p.low, p.high, Date.now(), JSON.stringify(p.research))
    .run();
}
