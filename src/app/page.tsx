import type { Metadata } from "next";
import Landing from "./_landing/Landing";

const SITE = "https://tadasouk.com";
const TITLE = "Tadasouk · Filmez vos produits, votre boutique se construit";
const DESCRIPTION =
  "Filmez vos produits et parlez. Tadasouk découpe chaque produit, écrit sa fiche, compare son prix aux boutiques marocaines et met votre boutique en ligne.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  icons: { apple: "/brand/apple-touch-icon.png" },
  openGraph: {
    type: "website",
    url: SITE,
    siteName: "Tadasouk",
    locale: "fr_FR",
    alternateLocale: ["en_US"],
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/brand/og.png", width: 1200, height: 630, alt: "Tadasouk" }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/brand/og.png"],
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Tadasouk",
  url: SITE,
  image: `${SITE}/brand/icon-512.png`,
  description: DESCRIPTION,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web, Android, iOS",
  inLanguage: ["fr", "en", "ar"],
  areaServed: { "@type": "Country", name: "Morocco" },
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "Ouverture de la boutique gratuite pendant le lancement" },
};

export default function Home() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <Landing />
    </>
  );
}
