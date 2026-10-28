// Who is calling. The Supabase session lives in cookies; `getClaims()` checks the token's
// signature (with the project's public keys) before we trust the user id in it.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/config";

export type SessionUser = { id: string; email?: string; phone?: string };

export class NotSignedInError extends Error {
  constructor() {
    super("Not signed in");
  }
}

export async function serverSupabase() {
  const store = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const c of list) store.set(c.name, c.value, c.options);
        } catch {
          // Server Components cannot set cookies; the browser client refreshes the session.
        }
      },
    },
  });
}

export async function currentUser(): Promise<SessionUser | null> {
  if (!SUPABASE_URL) return null;
  const { data } = await (await serverSupabase()).auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return { id: claims.sub, email: claims.email || undefined, phone: claims.phone || undefined };
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new NotSignedInError();
  return user;
}
