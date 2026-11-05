# Shared product catalog

Products any shop may sell, by barcode, in the Cloudflare D1 database `smallstore-catalog`
(binding `CATALOG`). A barcode read by the camera finds its product here before any AI is asked;
each product the research finds with certainty joins the catalog with its price range.

## Where the data comes from

Bulk exports of Open Food Facts, Open Beauty Facts, Open Pet Food Facts and Open Products Facts.
Those exports are the route the projects ask for; do not fill the catalog through their API.

| Part | Terms |
|---|---|
| Database | Open Database License (ODbL) |
| Single entries | Database Contents License |
| Photos | CC BY-SA, and they may show third-party graphics |

- The app must show the credit (Settings) and keep the `source` column.
- ODbL is share-alike: if we publicly use an adapted version of this database, we must offer that
  adapted database under the ODbL. Rows with `source = 'smallstore'` are our own research and stay
  apart from the Open Facts rows. Have this reviewed before a public launch.

## Rebuild

1. Stream the four exports and keep usable rows into `rows-<name>.jsonl`: all rows sold in Morocco
   and neighbouring markets, all beauty, pet and general products, and food scanned at least twice.
2. `python scripts/build-catalog.py <rows folder> <sql folder>` checks barcodes, maps the categories
   and writes SQL files, most useful products first.
3. `npx wrangler d1 execute smallstore-catalog --remote --file catalog/schema.sql`, then each SQL file.
4. Count the rows afterwards: a D1 import can stop in the middle of a file and still report success.

The categories come from word rules, so they are approximate: good for browsing, not for reports.
