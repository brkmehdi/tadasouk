// The platform owner's pages and actions. An account is admin when its profile says so (set by
// hand in the database, never from a browser: profiles.role cannot be updated by its owner).

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { currentUser } from "./auth";
import { signedVideoUrl } from "./video";
import { withDb } from "./db";

export async function adminUser() {
  const user = await currentUser();
  if (!user) return null;
  const role = await withDb(async (sql) => {
    const [row] = await sql<{ role: string }[]>`select role from public.profiles where id = ${user.id}::uuid`;
    return row?.role;
  });
  return role === "admin" ? user : null;
}

export type Account = {
  id: string;
  login: string;
  signup_method: string;
  ai_access: "pending" | "active";
  role: string;
  created_at: string;
  store: string | null;
  slug: string | null;
  published: boolean | null;
  products: number;
  balance_usd: string;
  spent_usd: string;
};

export function listAccounts() {
  return withDb(
    (sql) => sql<Account[]>`
      select p.id, coalesce(p.email, '+' || p.phone, '?') as login, p.signup_method, p.ai_access, p.role,
             p.created_at, s.name as store, s.slug, s.published,
             (select count(*) from public.products pr where pr.store_id = s.id)::int as products,
             coalesce(w.balance_usd, 0)::text as balance_usd,
             (select coalesce(sum(a.cost_usd), 0) from public.api_usage a where a.user_id = p.id)::text as spent_usd
      from public.profiles p
      left join public.stores s on s.owner_id = p.id
      left join public.ai_wallets w on w.user_id = p.id
      order by p.created_at desc`,
  );
}

// Filming sessions kept in R2 by /api/captures, newest first, with the account that filmed them.
export type Capture = {
  key: string;
  url: string; // signed for 12 hours
  uploaded: string;
  bytes: number;
  seconds: number;
  type: string;
  login: string | null;
  store: string | null;
  slug: string | null;
};

export async function listCaptures(): Promise<Capture[]> {
  const { MEDIA: media, MEDIA_LINK_SECRET: secret } = getCloudflareContext().env;
  if (!secret) throw new Error("MEDIA_LINK_SECRET is not set");
  const objects: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const page = await media.list({ prefix: "captures/", cursor, include: ["httpMetadata", "customMetadata"] });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  const owners = [...new Set(objects.map((o) => o.key.split("/")[2]).filter((id) => /^[0-9a-f-]{36}$/.test(id)))];
  const who = new Map(
    owners.length
      ? (
          await withDb(
            (sql) => sql<{ id: string; login: string; store: string | null; slug: string | null }[]>`
              select p.id, coalesce(p.email, '+' || p.phone, '?') as login, s.name as store, s.slug
              from public.profiles p left join public.stores s on s.owner_id = p.id
              where p.id in ${sql(owners)}`,
          )
        ).map((r) => [r.id, r])
      : [],
  );

  const sorted = objects.sort((a, b) => b.uploaded.getTime() - a.uploaded.getTime());
  return Promise.all(
    sorted.map(async (o) => {
      const owner = who.get(o.key.split("/")[2]);
      return {
        key: o.key,
        url: await signedVideoUrl(o.key, secret),
        uploaded: o.uploaded.toISOString(),
        bytes: o.size,
        seconds: Number(o.customMetadata?.seconds ?? 0),
        type: o.httpMetadata?.contentType ?? "video/webm",
        login: owner?.login ?? null,
        store: owner?.store ?? null,
        slug: owner?.slug ?? null,
      };
    }),
  );
}
