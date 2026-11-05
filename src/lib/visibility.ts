// Shared by the public files of a store (llms.txt, feed.xml) and the merchant's tools that show
// them: the stock marketplaces are told, and where each file lives. Server and browser alike.

// Marketplaces see the stock minus the safety margin (percent), rounded down: 50 at 20% -> 40.
// Integer maths, so 50 never becomes 39.
export const marketplaceQty = (stock: number, margin: number) => Math.max(0, Math.floor((stock * (100 - margin)) / 100));

export const storeFiles = (slug: string) => ({
  llms: `/${slug}/llms.txt`,
  feed: `/${slug}/feed.xml`,
});

export function xmlEscape(s: string) {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}
