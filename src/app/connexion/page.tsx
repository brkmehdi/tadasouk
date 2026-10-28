import type { Metadata } from "next";
import SignIn from "./SignIn";

export const metadata: Metadata = { title: "Connexion · SmallStore" };

// ?erreur=lien: a Google or email link that could not be used (see /auth/callback).
export default async function ConnexionPage({ searchParams }: { searchParams: Promise<{ erreur?: string }> }) {
  const { erreur } = await searchParams;
  return <SignIn linkError={!!erreur} />;
}
