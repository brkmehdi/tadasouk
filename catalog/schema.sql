-- The shared catalog, in the D1 database smallstore-catalog (binding CATALOG).
-- barcode: 13 digits, zero padded. nearby: sold in Morocco or a neighbouring market.
-- source: open_food_facts, open_beauty_facts, open_pet_food_facts, open_products_facts (all ODbL)
-- or smallstore (found by our research). Keep the source: it decides what must stay attributed.
create table if not exists catalog (
  barcode text primary key,
  name text not null,
  brand text,
  quantity text,
  category text not null,
  image_url text,
  source text not null,
  nearby integer not null default 0,
  scans integer not null default 0,
  price_low real,
  price_high real,
  price_at integer,
  research text -- the whole research result as JSON: names, description, prices, note, shop links
) without rowid;

-- Name search, for a product that is photographed and not scanned. It holds only part of the catalog
-- on the free plan: 100,000 rows may be written a day, and each row here writes several.
create virtual table if not exists catalog_search using fts5(barcode unindexed, title, tokenize = 'unicode61 remove_diacritics 2');
