"use client";

// Interface text in French (default) and English. The choice is kept in the "lang" cookie so
// the server renders the same language; `useT()` gives the words of the current one.

import { createContext, useContext, useState } from "react";
import { LANG_COOKIE, type Lang } from "./lang";

export type { Lang };

const fr = {
  "nav.home": "Accueil",
  "nav.products": "Produits",
  "nav.sales": "Ventes",
  "nav.settings": "Réglages",
  "nav.record": "Filmer mes produits",

  "header.online": "En ligne",
  "header.offline": "Pas encore en ligne",

  "guide.title": "Bienvenue ! Votre boutique en 4 gestes",
  "guide.step1": "Touchez le bouton rouge en bas : la caméra s'ouvre.",
  "guide.step2": "Montrez un produit au centre et tenez le téléphone immobile une seconde : il est pris tout seul.",
  "guide.step3": "Dites son prix, par exemple « hada b miya » ou « 100 dirhams ».",
  "guide.step4": "Mettez-le en ligne : touchez le produit, ou dites « mets-le en ligne ».",
  "guide.go": "Ouvrir la caméra",
  "guide.done": "Bravo, votre boutique a ses premiers produits en ligne.",
  "guide.hide": "Masquer le guide",
  "guide.show": "Revoir le guide",

  "home.drafts": "Brouillons",
  "home.online": "En ligne",
  "home.sales": "Ventes",
  "home.latest": "Derniers produits",
  "home.seeAll": "Tout voir",

  "products.title": "Produits",
  "products.empty": "Pas encore de produit. Touchez le bouton rouge et montrez un produit à la caméra.",
  "products.draft": "Brouillon",
  "products.online": "En ligne",
  "products.noName": "Sans nom",
  "products.noPrice": "Prix ?",
  "products.publish": "Mettre en ligne",
  "products.unpublish": "Retirer de la boutique",
  "products.delete": "Supprimer ce produit",
  "products.deleteConfirm": "Supprimer ce produit ? Ses photos aussi.",
  "products.name": "Nom",
  "products.price": "Prix",
  "products.stock": "Stock",
  "products.description": "Description",
  "products.save": "Enregistrer",
  "products.saved": "Enregistré",
  "products.publishAll": "Tout mettre en ligne",

  "sales.title": "Ventes",
  "sales.empty": "Pas encore de commande. Les commandes de votre boutique en ligne arriveront ici.",
  "sales.counter": "Vente au comptoir",
  "sales.counterHint": "Scannez ou touchez les produits, puis envoyez le reçu sur WhatsApp.",

  "settings.title": "Réglages",
  "settings.store": "Boutique",
  "settings.name": "Nom de la boutique",
  "settings.city": "Ville",
  "settings.whatsapp": "WhatsApp de la boutique",
  "settings.payments": "Paiements acceptés",
  "settings.cod": "Paiement à la livraison",
  "settings.card": "Carte bancaire",
  "settings.cardSoon": "Bientôt, avec TChenTChen",
  "settings.credit": "Crédit client (carnet)",
  "settings.language": "Langue",
  "settings.save": "Enregistrer",
  "settings.saved": "Enregistré",
  "settings.signOut": "Se déconnecter",

  "common.cancel": "Annuler",
  "common.close": "Fermer",
  "common.error": "Ça n'a pas marché. Réessayez.",
  "common.back": "Retour au menu",
} as const;

export type Key = keyof typeof fr;

const en: Record<Key, string> = {
  "nav.home": "Home",
  "nav.products": "Products",
  "nav.sales": "Sales",
  "nav.settings": "Settings",
  "nav.record": "Film my products",

  "header.online": "Online",
  "header.offline": "Not online yet",

  "guide.title": "Welcome! Your store in 4 steps",
  "guide.step1": "Tap the red button below: the camera opens.",
  "guide.step2": "Show a product in the middle and hold the phone still for a second: it is taken by itself.",
  "guide.step3": "Say its price, for example \"100 dirhams\".",
  "guide.step4": "Put it online: tap the product, or say \"put it online\".",
  "guide.go": "Open the camera",
  "guide.done": "Well done, your store has its first products online.",
  "guide.hide": "Hide the guide",
  "guide.show": "Show the guide",

  "home.drafts": "Drafts",
  "home.online": "Online",
  "home.sales": "Sales",
  "home.latest": "Latest products",
  "home.seeAll": "See all",

  "products.title": "Products",
  "products.empty": "No product yet. Tap the red button and show a product to the camera.",
  "products.draft": "Draft",
  "products.online": "Online",
  "products.noName": "No name",
  "products.noPrice": "Price?",
  "products.publish": "Put online",
  "products.unpublish": "Take off the store",
  "products.delete": "Delete this product",
  "products.deleteConfirm": "Delete this product? Its photos too.",
  "products.name": "Name",
  "products.price": "Price",
  "products.stock": "Stock",
  "products.description": "Description",
  "products.save": "Save",
  "products.saved": "Saved",
  "products.publishAll": "Put everything online",

  "sales.title": "Sales",
  "sales.empty": "No order yet. Orders from your online store will arrive here.",
  "sales.counter": "Counter sale",
  "sales.counterHint": "Scan or tap the products, then send the receipt on WhatsApp.",

  "settings.title": "Settings",
  "settings.store": "Store",
  "settings.name": "Store name",
  "settings.city": "City",
  "settings.whatsapp": "Store WhatsApp",
  "settings.payments": "Payments accepted",
  "settings.cod": "Cash on delivery",
  "settings.card": "Bank card",
  "settings.cardSoon": "Soon, with TChenTChen",
  "settings.credit": "Customer credit (credit book)",
  "settings.language": "Language",
  "settings.save": "Save",
  "settings.saved": "Saved",
  "settings.signOut": "Sign out",

  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.error": "That did not work. Try again.",
  "common.back": "Back to the menu",
};

const words: Record<Lang, Record<Key, string>> = { fr, en };

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (k: Key) => string };
const I18n = createContext<Ctx>({ lang: "fr", setLang: () => {}, t: (k) => fr[k] });

export function I18nProvider({ initial, children }: { initial: Lang; children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial);
  const setLang = (l: Lang) => {
    document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = l;
    setLangState(l);
  };
  return <I18n.Provider value={{ lang, setLang, t: (k) => words[lang][k] }}>{children}</I18n.Provider>;
}

export const useT = () => useContext(I18n);
