"use client";

// Back office home. The red button opens the camera; the products, orders and shipping parts
// come next (Phase 1 plan, steps 2 and 3).

import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/browser";

type Store = { id: string; name: string; slug: string; city: string | null; whatsapp: string | null; published: boolean };

export default function BackOffice({ store }: { store: Store }) {
  const router = useRouter();

  const signOut = async () => {
    await supabase().auth.signOut();
    router.replace("/connexion");
  };

  return (
    <main className="flex min-h-dvh flex-col bg-white text-ink">
      <header className="flex items-center gap-3 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-medium">{store.name}</p>
          <p className="truncate text-xs text-ink-3">{store.published ? "En ligne" : "Pas encore en ligne"}</p>
        </div>
        <button type="button" className="text-sm text-ink-3" onClick={() => void signOut()}>
          Se déconnecter
        </button>
      </header>

      <section className="flex flex-col items-center px-6 pt-10 pb-12 text-center">
        <Link
          href="/capture"
          aria-label="Filmer mes produits"
          className="flex h-16 w-16 items-center justify-center rounded-full ring-[3px] ring-ink/80 active:scale-95"
        >
          <span className="h-[52px] w-[52px] rounded-full bg-red-500" />
        </Link>
        <p className="mt-4 text-sm font-medium">Filmer mes produits</p>
        <p className="mt-1 text-xs text-ink-3">Montrez un produit, dites son prix.</p>
      </section>

      <section className="border-t border-line px-5 py-6">
        <h2 className="text-sm font-medium">Produits</h2>
        <p className="mt-2 text-sm text-ink-3">Les produits que vous filmez apparaîtront ici.</p>
      </section>
    </main>
  );
}
