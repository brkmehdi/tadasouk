import type { Metadata } from "next";
import Link from "next/link";

// /confidentialite: the privacy policy, linked from the landing page footer and from the Google
// sign-in consent screen (Google requires one before the app can leave testing mode).
export const metadata: Metadata = {
  title: "Confidentialité · Tadasouk",
  description: "Les données que Tadasouk garde, pourquoi, chez qui, et comment les faire effacer.",
  alternates: { canonical: "/confidentialite" },
};

const CONTACT = "brk.mehdi@gmail.com";
const UPDATED = "5 novembre 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-[18px] font-bold tracking-[-0.01em]">{title}</h2>
      <div className="mt-2 space-y-2 text-[15px] leading-relaxed text-ink-2">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="min-h-dvh bg-white px-4 pb-16 pt-8 text-ink">
      <div className="mx-auto max-w-[680px]">
        <Link href="/" aria-label="Tadasouk, accueil">
          {/* eslint-disable-next-line @next/next/no-img-element -- a static SVG logo */}
          <img src="/brand/tadasouk-horizontal-color.svg" alt="Tadasouk" width={129} height={40} className="h-9 w-auto" />
        </Link>

        <h1 className="mt-10 text-[30px] font-extrabold leading-tight tracking-[-0.035em]">Confidentialité</h1>
        <p className="mt-2 text-sm text-ink-3">Mise à jour le {UPDATED}.</p>

        <Section title="Ce que Tadasouk garde">
          <p>
            Pour le compte du commerçant : son e-mail ou son numéro de téléphone, et son nom si la connexion passe par Google.
          </p>
          <p>
            Pour sa boutique : le nom de la boutique, la ville, les produits, leurs prix, leurs photos, et les commandes reçues.
          </p>
          <p>
            Pour un client qui commande dans une boutique : le nom, le téléphone et l&apos;adresse de livraison qu&apos;il saisit.
            Le commerçant s&apos;en sert pour confirmer et livrer la commande.
          </p>
        </Section>

        <Section title="Pourquoi">
          <p>
            Ces données servent à faire marcher le service : ouvrir le compte, construire la boutique, afficher les produits et
            transmettre les commandes au commerçant. Tadasouk ne vend aucune donnée et n&apos;affiche aucune publicité.
          </p>
        </Section>

        <Section title="Chez qui elles sont">
          <p>Cloudflare héberge le site, les photos et les vidéos des produits.</p>
          <p>Supabase garde la base de données et les comptes, dans un centre de données à Francfort (Allemagne).</p>
          <p>
            Les photos, les images de la vidéo et la voix du commerçant passent par les modèles d&apos;IA de Meta pour reconnaître
            les produits, écrire les fiches et comprendre les prix dictés.
          </p>
          <p>Google reçoit la demande de connexion quand le commerçant choisit &laquo;&nbsp;Continuer avec Google&nbsp;&raquo;.</p>
        </Section>

        <Section title="Cookies et stockage">
          <p>
            Un cookie garde la session du commerçant connecté. Le navigateur garde le panier du client et la langue choisie.
            Aucun cookie de publicité ni de mesure d&apos;audience.
          </p>
        </Section>

        <Section title="Durée">
          <p>Les données restent tant que le compte existe. Le commerçant peut demander l&apos;effacement de son compte et de sa boutique à tout moment.</p>
        </Section>

        <Section title="Vos droits">
          <p>
            Vous pouvez demander l&apos;accès à vos données, leur correction ou leur effacement, selon la loi marocaine 09-08 et,
            pour les personnes en Europe, le RGPD. Écrivez à <a className="text-brand underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>.
            La réponse arrive sous 30 jours.
          </p>
        </Section>

        <section className="mt-12 border-t border-line pt-6" lang="en">
          <h2 className="text-[18px] font-bold tracking-[-0.01em]">In English</h2>
          <div className="mt-2 space-y-2 text-[15px] leading-relaxed text-ink-2">
            <p>
              Tadasouk keeps the merchant&apos;s email or phone number, their shop, products, prices, photos and orders, and the
              name, phone and delivery address a customer enters when ordering. The data runs the service and is never sold.
            </p>
            <p>
              Cloudflare hosts the site and media, Supabase keeps the database in Frankfurt, Meta&apos;s AI models read the photos,
              video frames and voice, and Google handles &quot;Continue with Google&quot;. One cookie keeps the merchant signed in; no
              advertising or analytics cookies.
            </p>
            <p>
              To see, correct or delete your data, write to{" "}
              <a className="text-brand underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>. Answer within 30 days.
            </p>
          </div>
        </section>

        <p className="mt-12 text-sm">
          <Link href="/" className="text-brand underline">Retour à l&apos;accueil</Link>
        </p>
      </div>
    </main>
  );
}
