// Landing page text, French (default) and English. Keep the two languages in step: same keys,
// same order. Every claim here matches a feature listed in README.md and CHANGELOG.md.

export type Lang = "fr" | "en";

type Item = { t: string; d: string };
type Step = { t: string; d: string; img: string; alt: string };
type Faq = { q: string; a: string };

export type Copy = {
  nav: { how: string; features: string; morocco: string; faq: string; label: string };
  signIn: string;
  open: string;
  langLabel: string;
  hero: {
    eyebrow: string;
    h1: string;
    sub: string;
    demo: string;
    note: string;
    phoneAlt: string;
    ask: string;
  };
  how: { h2: string; intro: string; steps: Step[]; credit: string };
  features: { h2: string; intro: string; items: Item[] };
  morocco: { h2: string; intro: string; items: Item[] };
  meta: { h2: string; intro: string; models: { name: string; d: string }[]; note: string };
  start: { h2: string; steps: Item[] };
  faq: { h2: string; items: Faq[] };
  close: { h2: string; sub: string };
  footer: { tagline: string; demo: string; privacy: string; hackathon: string; rights: string };
};

const fr: Copy = {
  nav: {
    how: "Comment ça marche",
    features: "Fonctions",
    morocco: "Maroc",
    faq: "Questions",
    label: "Sections de la page",
  },
  signIn: "Se connecter",
  open: "Ouvrir ma boutique",
  langLabel: "Langue",
  hero: {
    eyebrow: "Pour les petits commerçants du Maroc",
    h1: "Filmez vos produits et parlez. Votre boutique se construit toute seule.",
    sub: "Tadasouk découpe chaque produit dans la vidéo, écrit sa fiche et compare son prix aux boutiques marocaines. Vous donnez les prix à la voix, en darija, en français, en arabe ou en anglais. La boutique est en ligne à l'adresse tadasouk.com/votre-boutique.",
    demo: "Voir une boutique en ligne",
    note: "Un téléphone avec une caméra suffit.",
    phoneAlt: "Un fond de teint KIKO filmé en main dans une boutique marocaine. L'application demande son prix.",
    ask: "Quel est le prix de « Fond de teint KIKO 2 en 1 » ?",
  },
  how: {
    h2: "De la vidéo à la vente, en cinq étapes",
    intro: "Le commerçant garde ses habitudes. Il montre ses produits, il parle, et Tadasouk fait le reste.",
    steps: [
      { t: "Filmez", d: "Appuyez sur le bouton rouge et montrez vos produits. Tenez un produit immobile au centre et l'application le capture.", img: "/landing/step-film-boxes.webp", alt: "Boîtes de conservation posées sur le comptoir d'un magasin." },
      { t: "Parlez", d: "Dites le prix, la remise ou le stock. L'application pose une question quand il manque une information.", img: "/landing/step-talk-mascara.webp", alt: "Un mascara tenu en main devant le présentoir." },
      { t: "Mettez en ligne", d: "Chaque produit filmé devient un brouillon avec ses photos. Un bouton ou une phrase le met en ligne.", img: "/landing/step-online-palette.webp", alt: "Un coffret de maquillage ouvert, avec tous ses produits." },
      { t: "Vendez", d: "Vos clients commandent sur votre boutique et paient à la livraison. Au comptoir, le reçu part sur WhatsApp.", img: "/landing/step-sell-bowl.webp", alt: "Un saladier rose sur le comptoir du magasin." },
      { t: "Comptez", d: "Prenez une photo de l'étagère. L'application retrouve vos produits et les compte, puis vous mettez le stock à jour.", img: "/landing/step-count-bag.webp", alt: "Une trousse remplie de produits de maquillage." },
    ],
    credit: "Photos tirées de vraies vidéos de vendeurs marocains.",
  },
  features: {
    h2: "Ce que fait Tadasouk",
    intro: "Neuf fonctions, toutes dans la même application, sur le téléphone du commerçant.",
    items: [
      { t: "Capture en direct", d: "Un détecteur sur le téléphone entoure le produit en temps réel. SAM 3.1 le découpe et le pose sur fond blanc avec une ombre douce. Un produit montré deux fois n'est capturé qu'une fois." },
      { t: "Prix à la voix", d: "Parlez en darija, en français, en arabe ou en anglais. Un agent transforme vos phrases en actions : prix, remise, nom, description, stock, annuler, produit suivant." },
      { t: "Fiche produit prête", d: "Nom et description en français et en arabe, une photo IA du produit (d'autres sur demande) et des photos trouvées sur des sites de boutiques. La meilleure photo devient la photo principale." },
      { t: "Prix du marché marocain", d: "Une recherche sur les boutiques marocaines donne le prix le plus bas, le prix moyen, le plus haut et un prix conseillé, avec les sources." },
      { t: "Votre boutique en ligne", d: "Accueil, catégories, recherche, pages produit avec couleurs et tailles, panier et commande. Partagée sur WhatsApp, chaque page produit s'affiche avec sa photo et son prix." },
      { t: "Livraison et crédit", d: "Vos clients paient à la livraison, ou à crédit si vous l'activez. La base de données calcule chaque commande avec la livraison et les codes promo." },
      { t: "Vente au comptoir", d: "Scannez le code-barres des produits. Le stock baisse et le reçu part sur le WhatsApp du client." },
      { t: "Stock sur une photo", d: "Sur une photo d'étagère, l'IA place un point numéroté sur chaque article, couleur par couleur. Vous retirez un point faux, puis vous mettez le stock à jour." },
      { t: "La boutique qui écoute", d: "Dites ce qu'il faut changer : un prix, une catégorie, une livraison, un code promo. La boutique le fait et répond à voix haute. Vous pouvez annuler chaque changement." },
    ],
  },
  morocco: {
    h2: "Les habitudes des boutiques marocaines sont déjà dans Tadasouk",
    intro: "La langue, la monnaie, le paiement et la messagerie que vos clients utilisent déjà.",
    items: [
      { t: "Darija", d: "L'application comprend la darija à l'oral, comme l'arabe, le français et l'anglais. Les fiches produit sont écrites en français et en arabe." },
      { t: "Dirhams", d: "Les prix sont en dirhams. La comparaison de prix se fait sur des boutiques marocaines." },
      { t: "Paiement à la livraison", d: "C'est le mode de paiement par défaut de chaque boutique. Le crédit client s'active dans les réglages." },
      { t: "WhatsApp", d: "Reçus de vente, partage des produits avec aperçu, et message au vendeur après la commande." },
    ],
  },
  meta: {
    h2: "Construit avec les modèles de Meta",
    intro: "Tadasouk a été créé pendant le Meta Global AI Developer Hackathon, du 26 octobre au 4 novembre 2026. Quatre modèles de Meta font le travail.",
    models: [
      { name: "Muse Spark 1.3", d: "Les deux agents vocaux, la vérification des prix, le comptage du stock et la note des photos." },
      { name: "SAM 3.1", d: "Le détourage de chaque produit filmé." },
      { name: "Muse Image 1.0", d: "Les photos du produit sous d'autres angles et la photo d'accueil de la boutique." },
      { name: "Muse Voice Transcribe 1.0", d: "La transcription de ce que vous dites, pour les sous-titres et les agents." },
    ],
    note: "Le serveur ajoute la clé de l'API à chaque appel. Elle n'arrive jamais dans le navigateur.",
  },
  start: {
    h2: "Trois étapes pour ouvrir votre boutique",
    steps: [
      { t: "Créez votre compte", d: "Avec votre e-mail ou votre compte Google." },
      { t: "Nommez votre boutique", d: "Elle reçoit sa propre adresse, par exemple tadasouk.com/epicerie-amal." },
      { t: "Filmez votre premier produit", d: "Le back office s'ouvre sur le bouton rouge. Appuyez et parlez." },
    ],
  },
  faq: {
    h2: "Questions fréquentes",
    items: [
      { q: "Faut-il un site web ou un hébergement ?", a: "Non. Votre boutique a son adresse sur tadasouk.com dès sa création. Vos produits y apparaissent quand vous les mettez en ligne." },
      { q: "Combien ça coûte ?", a: "Pendant le lancement, ouvrir une boutique ne coûte rien. Les fonctions d'IA consomment un crédit IA. Chaque nouveau compte reçoit 2 $ de crédit (automatique pour les dix premiers comptes, puis après validation)." },
      { q: "Dans quelles langues puis-je parler ?", a: "Darija, français, arabe et anglais. Le back office est en français et en anglais." },
      { q: "Comment mes clients paient-ils ?", a: "À la livraison, ou à crédit si vous l'activez dans les réglages. Le paiement par carte arrive plus tard." },
      { q: "Faut-il installer une application ?", a: "Non. Tadasouk s'ouvre dans le navigateur du téléphone. Vous pouvez l'ajouter à l'écran d'accueil comme une application." },
      { q: "Qui voit les données de ma boutique ?", a: "Chaque commerçant accède seulement aux données de sa boutique. Les visiteurs voient seulement les produits en ligne." },
    ],
  },
  close: {
    h2: "Votre premier produit peut être en ligne aujourd'hui",
    sub: "Ouvrez votre boutique, appuyez sur le bouton rouge et montrez ce que vous vendez.",
  },
  footer: {
    tagline: "Filmez vos produits et parlez. Votre boutique se construit toute seule.",
    demo: "Boutique de démonstration",
    privacy: "Confidentialité",
    hackathon: "Créé pour le Meta Global AI Developer Hackathon 2026.",
    rights: "Tous droits réservés.",
  },
};

const en: Copy = {
  nav: {
    how: "How it works",
    features: "Features",
    morocco: "Morocco",
    faq: "Questions",
    label: "Page sections",
  },
  signIn: "Sign in",
  open: "Open my shop",
  langLabel: "Language",
  hero: {
    eyebrow: "For small shops in Morocco",
    h1: "Film your products and talk. Your shop builds itself.",
    sub: "Tadasouk cuts each product out of the video, writes its page and compares its price with Moroccan shops. You set prices by voice, in Darija, French, Arabic or English. Your shop goes online at tadasouk.com/your-shop.",
    demo: "See a live shop",
    note: "All you need is a phone with a camera.",
    phoneAlt: "A KIKO foundation filmed in hand in a Moroccan shop. The app asks for its price.",
    ask: "What is the price of \"KIKO 2-in-1 foundation\"?",
  },
  how: {
    h2: "From video to sale in five steps",
    intro: "Shop owners keep their habits. They show their products, they talk, and Tadasouk does the rest.",
    steps: [
      { t: "Film", d: "Press the red button and show your products. Hold a product still in the centre and the app captures it.", img: "/landing/step-film-boxes.webp", alt: "Food storage boxes on a shop counter." },
      { t: "Talk", d: "Say the price, the discount or the stock. The app asks a question when something is missing.", img: "/landing/step-talk-mascara.webp", alt: "A mascara held in hand in front of the display." },
      { t: "Go online", d: "Each filmed product becomes a draft with its photos. One button or one sentence puts it online.", img: "/landing/step-online-palette.webp", alt: "An open make-up gift box with all its products." },
      { t: "Sell", d: "Customers order from your shop and pay on delivery. At the counter, the receipt goes out on WhatsApp.", img: "/landing/step-sell-bowl.webp", alt: "A pink bowl on the shop counter." },
      { t: "Count", d: "Take a photo of the shelf. The app finds your products and counts them, then you update the stock.", img: "/landing/step-count-bag.webp", alt: "A make-up bag full of products." },
    ],
    credit: "Photos taken from real videos by Moroccan sellers.",
  },
  features: {
    h2: "What Tadasouk does",
    intro: "Nine features, all in one app, on the shop owner's phone.",
    items: [
      { t: "Live capture", d: "A detector on the phone outlines the product in real time. SAM 3.1 cuts it out and places it on a white background with a soft shadow. A product shown twice is captured once." },
      { t: "Prices by voice", d: "Speak Darija, French, Arabic or English. An agent turns what you say into actions: price, discount, name, description, stock, undo, next product." },
      { t: "Product page ready", d: "Name and description in French and Arabic, an AI photo of the product (more on request) and photos found on shop websites. The best photo becomes the main photo." },
      { t: "Moroccan market prices", d: "A search across Moroccan shops gives the lowest, average and highest price and a suggested price, with the sources." },
      { t: "Your online shop", d: "Home, categories, search, product pages with colours and sizes, cart and checkout. Shared on WhatsApp, each product page shows its photo and price." },
      { t: "Delivery and credit", d: "Customers pay on delivery, or on credit if you turn it on. The database prices each order with delivery and promotion codes." },
      { t: "Counter sale", d: "Scan the products' barcodes. The stock goes down and the receipt goes to the customer's WhatsApp." },
      { t: "Stock from a photo", d: "On a shelf photo, the AI puts a numbered dot on each item, colour by colour. You remove a wrong dot, then update the stock." },
      { t: "The shop that listens", d: "Say what to change: a price, a category, a delivery method, a promotion code. The shop does it and answers aloud. You can undo each change." },
    ],
  },
  morocco: {
    h2: "How Moroccan shops work is already in Tadasouk",
    intro: "The language, the currency, the payment and the messaging your customers already use.",
    items: [
      { t: "Darija", d: "The app understands spoken Darija, as well as Arabic, French and English. Product pages are written in French and Arabic." },
      { t: "Dirhams", d: "Prices are in dirhams. The price check compares with Moroccan shops." },
      { t: "Cash on delivery", d: "It is every shop's default payment method. Customer credit is turned on in Settings." },
      { t: "WhatsApp", d: "Sale receipts, product sharing with a preview, and a message to the seller after ordering." },
    ],
  },
  meta: {
    h2: "Built on Meta's models",
    intro: "Tadasouk was built during the Meta Global AI Developer Hackathon, from 26 October to 4 November 2026. Four Meta models do the work.",
    models: [
      { name: "Muse Spark 1.3", d: "Both voice agents, the price check, the stock count and the photo scores." },
      { name: "SAM 3.1", d: "Cutting out each filmed product." },
      { name: "Muse Image 1.0", d: "Product photos from other angles and the shop's cover photo." },
      { name: "Muse Voice Transcribe 1.0", d: "Transcribing what you say, for the captions and the agents." },
    ],
    note: "The server adds the API key to each call. It never reaches the browser.",
  },
  start: {
    h2: "Three steps to open your shop",
    steps: [
      { t: "Create your account", d: "With your email or your Google account." },
      { t: "Name your shop", d: "It gets its own address, for example tadasouk.com/amal-grocery." },
      { t: "Film your first product", d: "The back office opens on the red button. Press it and talk." },
    ],
  },
  faq: {
    h2: "Common questions",
    items: [
      { q: "Do I need a website or hosting?", a: "No. Your shop has its address on tadasouk.com from the start. Your products appear there when you put them online." },
      { q: "How much does it cost?", a: "During the launch, opening a shop costs nothing. AI features use AI credit. Each new account gets $2 of credit (automatic for the first ten accounts, then after approval)." },
      { q: "Which languages can I speak?", a: "Darija, French, Arabic and English. The back office is in French and English." },
      { q: "How do my customers pay?", a: "On delivery, or on credit if you turn it on in Settings. Card payment comes later." },
      { q: "Do I need to install an app?", a: "No. Tadasouk opens in the phone's browser. You can add it to your home screen like an app." },
      { q: "Who sees my shop's data?", a: "Each shop owner only reaches their own shop's data. Visitors only see products that are online." },
    ],
  },
  close: {
    h2: "Your first product can be online today",
    sub: "Open your shop, press the red button and show what you sell.",
  },
  footer: {
    tagline: "Film your products and talk. Your shop builds itself.",
    demo: "Demo shop",
    privacy: "Privacy",
    hackathon: "Built for the Meta Global AI Developer Hackathon 2026.",
    rights: "All rights reserved.",
  },
};

export const COPY: Record<Lang, Copy> = { fr, en };

// Live store shown by "See a live shop". Change it when a better demo store exists.
export const DEMO_SLUG = "test";
