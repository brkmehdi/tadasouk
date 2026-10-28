// The platform owner's pages and actions. An account is admin when its profile says so (set by
// hand in the database, never from a browser: profiles.role cannot be updated by its owner).

import { currentUser } from "./auth";
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
