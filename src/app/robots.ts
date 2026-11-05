// /robots.txt: search engines and AI assistants are welcome on the public stores; the back
// office, the API and the admin stay out. Points to the sitemap.

import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/storefront";

// Named so a store owner reading the file sees they are invited, not only allowed by default.
const AI_CRAWLERS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "PerplexityBot", "Google-Extended", "Applebot-Extended", "Meta-ExternalAgent"];
// Each page and what is under it, but not a store whose slug starts the same ("/apple-store").
const PRIVATE = ["/app", "/admin", "/api", "/auth", "/capture", "/connexion"].flatMap((p) => [`${p}$`, `${p}/`]);

export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = await siteOrigin();
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE },
      { userAgent: AI_CRAWLERS, allow: "/", disallow: PRIVATE },
    ],
    sitemap: `${origin}/sitemap.xml`,
  };
}
