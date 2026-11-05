import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@/lib/server/auth";
import SignOutButton from "../SignOutButton";
import SignIn from "./SignIn";

export const metadata: Metadata = { title: "Connexion · Tadasouk" };

// ?erreur=lien: a Google or email link that could not be used (see /auth/callback).
// Already signed in: a bar on top says with which account, to go on or sign out first.
export default async function ConnexionPage({ searchParams }: { searchParams: Promise<{ erreur?: string }> }) {
  const { erreur } = await searchParams;
  const user = await currentUser();
  const who = user ? (user.email ?? (user.phone ? `+${user.phone}` : null)) : null;
  return (
    <>
      {user && (
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-b border-line bg-soft px-4 py-3 text-sm">
          <span className="text-ink-2">Vous êtes connecté{who ? ` avec ${who}` : ""}.</span>
          <Link href="/app" className="font-medium text-brand">
            Ouvrir ma boutique
          </Link>
          <SignOutButton />
        </div>
      )}
      <SignIn linkError={!!erreur} />
    </>
  );
}
