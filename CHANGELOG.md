# Changelog

Everything in this repository was written during the Meta Global AI Developer Hackathon
(indie track, deadline 2026-11-04 21:00 ET).

## 2026-10-27

Phase 0, live capture spike.

- Project set up: Next.js 16 (App Router, TypeScript, Tailwind) on Cloudflare Workers through the
  OpenNext adapter, PWA manifest and service worker, AGPL-3.0 license.
- Record screen (`/capture`): one record button; camera and microphone through getUserMedia;
  MediaRecorder keeps the full video.
- Live highlight: MediaPipe Object Detector (EfficientDet Lite0) runs on the phone and draws a
  glowing outline around the product nearest the center.
- Capture: holding a product still near the center for 800 ms, saying "this one" / "hada", or
  tapping it sends one keyframe to `/api/segment`, which calls `sam-3.1` with the detector box as a
  box prompt. The browser decodes the mask with `@meta-sam/parser` and cuts the product out on a
  canvas. The card flies into the tray with a shimmer price placeholder.
- Voice: energy-based voice activity detection cuts speech into short 16 kHz WAV chunks that
  `/api/transcribe` sends to `muse-voice-transcribe-1.0` (bias: Arabic, French, English).
  Captions show at the bottom.
- Agent: each transcript goes to `muse-spark-1.3` (reasoning effort low) with the session state.
  Tools: create_product, set_price, apply_discount, rename_product, set_quantity, remove_product,
  undo_last, ask_merchant. UI reacts: price types in, discounts strike the old price, removed
  cards shrink and fade, unclear commands show a question mark and the question in the caption.
- Spending caps per capture session and per day, checked before every Meta API call, with one
  usage log line per call (`/api/usage` shows the totals).
- Raw video upload straight from the browser to R2 with a short-lived signed URL (`/api/upload-url`).
- Product cards: ✕ deletes a product, + adds more photos to the same product (next captures go to it).
- Tap a card: it grows into a product sheet over the video (recording keeps going) with all photos,
  name, price, stock and description; voice commands apply to the open product. Closing shrinks it
  back into its card.
- "Better photos" (button or voice): `muse-image-1.0` takes the real product photo, looks the
  product up on the web by itself, and returns two studio photos marked "IA".
- "Is my price competitive?" (button or voice): `muse-spark-1.3` with web search from Morocco returns
  the lowest, average and highest price found, a verdict and the sources.
- New agent tools: set_description, find_better_photos, check_price.
- Same product shown twice no longer makes a second card: a visual fingerprint (hue histogram
  plus difference hash, robust to light and tilt) is checked on the crop before SAM and on the
  cutout after it. The existing card pulses and becomes the current product instead. A tap
  still forces a capture.
- Capture effect: white flash, synthesized shutter click, the shot zooms and flies into its card.
- Default product photo: the SAM cutout on white with a soft contact shadow, made on the phone.
- Naming: `/api/identify` (muse-spark-1.3 image understanding, JSON output) names each new
  product in French and Arabic, with a category and a description draft.
- When the merchant moves on to the next product (or stops), research runs in the background:
  studio version of the real photos (`/api/studio-photo`: muse-image-1.0 paints backdrop and
  shadow only; the real cutout is pasted back and a fidelity check rejects a moved product),
  web-guided photos, and the price check, which now returns a suggested price.
- One question at a time about what is missing (price with a one-tap suggested price, name,
  stock); "oui / wakha" by voice accepts the suggestion.
- Cards: fixed name and price lines; a dashed "≈ suggested" chip until a price is set.
  Captions sit in their own band, never over the tray. Product sheet shows the suggested price
  first, with "Détails" for lowest / average / highest, the note and sources.
- Tap capture: four SAM prompts in one request (point alone and point plus three box sizes),
  the most confident mask kept and nested masks merged back, so tapping a label still cuts out
  the whole product.
- Caps raised to $1.50 per session and $10 per day for the background research.
- Capture flow from phone testing: auto-capture takes one product, then waits; a small "+"
  (or saying "produit suivant") arms the next one, so nothing else gets grabbed while the
  merchant talks. "hada" only captures when a new product is expected.
- Research starts as soon as a product is cut out. The AI results are proposals: the product
  sheet has "Tout utiliser" and an "Utiliser" under each field; voice "utilise tout" works too.
  The price research now also returns the exact product name (FR/AR), description and category.
- Tap capture: `/api/locate` (muse-spark-1.3 image grounding) finds the whole product under the
  finger, so SAM cuts out the bottle and not just its label.
- Delete asks for confirmation. Small record button with echo rings while talking. One centered
  caption, two lines at most, fading out. Latency pill only with `?debug`.
- Design follows the SmallStore mockup store (Stripe-checkout look): white sheets, hairline
  fields, one blue main button; the frosted product cards stay.
- Studio photo fidelity check allows small shifts and pastes the real product where the model
  drew it.
- AI results now fill name and description directly (no "Tout utiliser"); the merchant edits
  what they do not like, and a field they edited is never overwritten. The price stays empty
  with a one-tap "Utiliser" on the suggested price.
- Hold to frame: hold a finger on the video for 1 s (a ring fills), a dashed frame appears,
  resizable while still holding; after lifting it moves and resizes by its corners, and a tap
  outside it takes the photo of what is inside. The frame snaps to the product the AI finds
  under the finger until the merchant touches it. A quick tap no longer captures.
- Photo research per product: 1 AI photo (badge IA) plus real photos from the shop pages the
  price research found (`/api/web-photos` reads their product image; badge shows the site).
- The product tray no longer blocks touches on the right side of the video.
- Barcodes: read on the phone (BarcodeDetector on Android, zxing-wasm 3.1.4 self-hosted
  elsewhere) about every 0.7 s while filming. A barcode in view goes to the current product
  with a bip; one that another product already has selects that product and drops a card just
  made for it. Product sheet: the code shows as a small line under the name only when known,
  otherwise a small "+ Code-barres" button.
- Sale screen ("Vente", after filming): scan products or tap them, adjust quantities, total,
  receipt sent on WhatsApp (wa.me link, Moroccan 06/07 numbers converted), stock lowered.
- Camera controls: the middle button takes the photo once the camera is on (frame, else the
  outlined product, else the middle of the picture); ✕ on the left leaves the camera; "+" on
  the right still arms the next automatic capture. No more hint texts for "+" buttons.
- "+" on each product card is back: the next photo goes to that product, then the mode ends.
- AI photos from three angles (three-quarter, side, back), one muse-image request each in
  parallel, using web references of the product for the sides the camera did not see; when an
  angle makes no sense for the product, it is shown in a hand or in use. Badges "IA · Dos" etc.
- Photo preview: tap a photo for a full-screen swipeable view with a quality score
  (`/api/photo-score`: muse-spark-1.3 rates sharpness, light, framing, background, plus one
  tip), "Mettre en principale" and "Supprimer". Web photos are scored by URL.
- iPhone: fields stay at 16px so Safari no longer zooms the page when one is focused.
- Hold-to-frame rebuilt as its own component (FrameOverlay) so dragging only redraws the
  frame: the hold ring sits 92 px above the finger, the frame opens nearly full screen and
  snaps onto the product, 4 corner brackets and 4 edge handles with 44 px touch areas, two-finger
  pinch, hint only once the frame shows.
- Auto-capture and the shutter only take a detected product whose box covers the image center
  (they grabbed a jar on a shelf behind the held product).
- design-kit/: build prompt for Muse (MUSE_PROMPT.md), design system, tokens (CSS and JSON),
  eight screenshots of the working app, two shop scenes made with muse-image-1.0, icon.
- Live preview on Cloudflare Workers. Cache Components turned off: it hangs in the Workers runtime.
- Latency panel on the record screen: first highlight, detector time per frame, capture to card,
  spoken command to UI update.

## 2026-10-28

- License changed from AGPL-3.0 to all rights reserved: the code is public only so judges can
  evaluate it (`LICENSE`, `"license": "UNLICENSED"` in `package.json`). No open source license
  file remains in the repository.
- `THIRD_PARTY_NOTICES.md`: every npm package with its license (generated with
  license-checker-rseidelsohn), plus MediaPipe, the EfficientDet-Lite0 model, the zxing wasm file,
  the Geist fonts and the generated Workers types.
- README: what was built during the hackathon and what is not built yet, TChenTChen as a
  preexisting component, a table of the Meta models with the file that calls each one, development
  tools, and a hackathon compliance checklist.
- Checked the full git history: no API key or other secret was ever committed.
- Product tray: with many products the column now scrolls on iPhone (it used to cut the last
  card and not move). It is only as tall as its cards, fades the edge where more cards are
  hidden, and scrolls back to the current card after each capture (`ProductTray.tsx`).
- Merchant accounts (Supabase Auth): Google, email + password, or phone with a code on WhatsApp.
  Supabase hands each phone code to `/api/auth/sms-hook` (Standard Webhooks signature checked)
  instead of sending an SMS; the WhatsApp reply comes in a later step. `/connexion`, store setup
  on first visit, back office at `/app` with the red record button; `/capture` needs a session.
- Database (`supabase/migrations`): profiles, stores, products and images, customers, shipping
  methods, orders and lines, payments, credit book with installment plans, merchant payouts, AI
  credit. Row level security on every table; 20 pgTAP tests (`supabase/tests`) check that a
  merchant cannot read another store or make itself admin, and that visitors see only what is
  published. Local stack with `npx supabase start`.
- AI credit per account: the AI routes need a session; each Meta API call is held then charged in
  Postgres ($0.50 free per day, reset at midnight in Morocco, then the prepaid balance), with one
  `api_usage` row per call. `/api/usage` returns what the account has left.
- Production database: Supabase project SmallStore (Frankfurt, free plan), same migrations, plus
  a grants migration from the security advisor (the sign-up trigger and `my_store_id()` are not
  callable by visitors). The Worker reaches it through Hyperdrive (caching off) as its own role
  `smallstore_worker` (app tables and functions only). Auth settings pushed from
  `supabase/config.toml` (`[remotes.production]`): site address, 8-character passwords, phone
  sign-up with the WhatsApp hook on the Worker. Checked live: a phone sign-in request reaches the
  hook and the code lands in the production database.
- Email sign-up no longer waits for a confirmation link during the hackathon (owner's choice): the
  account opens at once. To turn back on once a sender (Resend SMTP) is set up.
- Auto-capture for any product, not only the 80 kinds the on-device detector knows (bottle,
  cup...): when the phone is held still on something for about a second, a ring fills in the
  middle and `/api/locate` (new mode "held") says whether a product is there and where; only then
  is it cut out. Measured on the test scenes: a tea box (unknown to the detector) now becomes a card
  4.9 s after opening the camera, where it needed a tap before; a bottle 2.5 s.
- Auto-capture no longer waits for the detector to load: it can take long on a slow connection,
  and its GPU start can hang on some phones (now it falls back to the CPU after 5 s). The service
  worker keeps the detector files (about 17 MB) after the first visit.
- AI answers no longer wait for the usage write: it runs after the response is sent.
- Back office (`/app`): a menu like a shop's (Accueil, Produits, Ventes, Réglages) with the red
  record button in the middle. The button opens the camera over the menu in the same tap; its
  exit button comes back to the menu. French and English (switch in the header and in Settings,
  kept in a cookie).
- First-visit guide on the home tab: four steps (open the camera, show a product, say its price,
  put it online) that tick themselves from what the store holds; the red button pulses until the
  first product. Can be hidden and shown again.
- Every filmed product is saved as a draft while it changes (name, price, stock, description,
  photos, online or not): photos to R2 through `/api/media` (into the merchant's own store
  folder), served by `/media/...`; rows through Supabase with the merchant's session. Web photos
  stay out of the store (other shops' pictures).
- Putting products online: a button in the product sheet (camera) and in the Products tab, "Tout
  mettre en ligne", or by voice ("mets-le en ligne", "activez ces produits", "tl3o kamlin"; new
  agent tool `publish_products`). The first product online puts the store online.
- Products tab: filters (all, drafts, online), edit name, price, stock and description, delete.
  Sales tab: counter sale with the saved products (stock goes down). Settings: name, city,
  WhatsApp, cash on delivery and customer credit switches, language, sign out.
- AI credit policy (owner's choice): every new account gets $2 of AI once, automatically for the
  first 10 accounts; later accounts wait until the owner activates them in `/admin` (which gives
  the same $2). No daily free allowance any more. The back office shows the credit left, or that
  the account waits for activation; the AI routes say which of the two stopped a call.
- `/admin` (platform owner only): every account with its sign-up method, store, products, AI
  balance and spend; "Activer (2 $)" and "Offrir" (more credit).
- Public store at `/{slug}` (a path for now; a subdomain per store needs our own domain):
  hero photo (uploaded, made by muse-image-1.0 on request, or none: the store's name), tagline,
  product grid, product page with photos, add to basket, "Partager sur WhatsApp". Product pages
  carry Open Graph tags (WhatsApp shows the photo, name, price and description) and schema.org
  Product data. The merchant, signed in, previews drafts with a preview bar.
- Basket and order: cash on delivery (and credit when the store allows it); the database prices
  the order from the published products (`place_order`), numbers it per store and keeps the
  customer. The confirmation offers to write to the seller on WhatsApp.
- Back office: orders in Sales (confirm, shipped, delivered and paid with the cash payment
  recorded, cancel; WhatsApp and call the customer); photos of a saved product (add from the
  phone, remove, choose the cover), preview and WhatsApp share in the product editor; store look
  in Settings (hero photo, AI hero, tagline) and "Voir ma boutique" in the header.
- 27 database tests (welcome credit, activation, order pricing, drafts not orderable).
- Filming videos are kept: when the merchant stops the camera, the raw video goes to R2 in 8 MiB
  parts through `/api/captures` (signed-in merchants only; replaces the signed-URL route, which
  needed storage keys and let anyone upload). `/admin/videos` lists them with the account, store,
  length and size, plays them (with seeking) and downloads them.
- Video player in `/admin/videos` fixed: through Next.js the Worker read the whole file ahead of the
  player and ran out of memory (Cloudflare error 1102). A Worker entry (`worker.ts`) now streams
  `/media/captures/...` straight from R2 with correct byte ranges, behind links signed for the
  admin page (`MEDIA_LINK_SECRET`, 12 hours); every other request goes to Next.js as before.
- Store v2, laid out like the shop prototype designed for SmallStore (rebuilt in this codebase's
  own components; no file of the prototype is used): a header with the categories, search and the
  cart; home with best sellers and categories; category pages with sorting and filters; product
  pages with a gallery per colour, sizes, sold-out sizes, quantity, details and suggestions; a
  cart drawer; a cart page; a two-column checkout; a thank-you page.
- Database: product colours (photos per colour), sizes and sold-out combinations, promotion codes,
  discount and delivery on orders, colour and size on order lines; `cart_total` shared by
  `quote_cart` (cart and checkout) and `place_order` (refuses a line, code or delivery that
  changed). 17 more database tests.
- Back office: category, compare-at price, colours, sizes and the sold-out grid in the product
  editor; delivery methods and promotion codes in Settings. `/api/identify` gets the store's
  categories and reuses them.
- The store that listens (`/api/store-agent`, `StoreAssistant`): spoken or typed requests in the
  back office, done with tools under the merchant's own session, answered aloud, each change
  undoable, deletions confirmed by a button.
- Stock count from shelf photos (`/api/count`, `CountMode`, Products tab): one photo per shelf,
  the AI matches the items to a numbered grid of the store's product photos (one cell per colour)
  and returns a box for each; numbered dots on the photo, counts per product and per colour,
  wrong dots removed by a tap, − and +, several shelves added up, stock updated on confirmation.
  Tested on four shop shelves: colours kept apart, products not on the shelf never counted.

## 2026-11-01

Less heat on the phone, cleaner cutouts, lower cost per product, products from videos.

- Filming no longer records a video: the camera screen keeps nothing and uploads nothing.
  Videos already stored stay in `/admin/videos`.
- Where the browser can (Android Chrome), each product gets a real photo while the preview runs at
  540p; elsewhere the preview stays at 720p.
- The detector runs only on a steady picture, rests between looks, and stops when the browser
  reports pressure. A ring in the middle shows it: dotted while moving, green and filling when
  steady.
- The camera pauses after 60 seconds with no product, no recognised word and no touch.
- Cutouts: SAM gets the area around the product, enlarged, not the whole frame. The mask keeps the
  main pieces, fills small holes and gets a smooth edge.
- Product research is limited to 6 searches ($0.17 down to $0.04 a product).
- Each product gets one AI photo from another angle; each new request takes the next angle.
- The studio photo is gone: a product's photos are its real photo, one AI photo and at most 3 photos
  from shops.
- All of a product's photos are scored together in one request against the real photo, for quality
  and for fidelity (is it the exact product), then ranked. A photo that may show another product
  cannot come first; a main photo the merchant chose stays first. A shop photo that comes first is
  copied to the store.
- Shop links now come only from the search results: the model's own links were not real pages.
- The research sees the product's photo again, and its title replaces ours only when it found that
  very product: from the name alone it had turned a real car into a toy.
- A product the image AI refuses (tobacco, for example) says so, and the refused photo costs nothing.
- Shared catalog (`catalog/README.md`): a barcode read by the camera finds its product in the D1
  database before any AI is asked, and a product already priced needs no new search. Each product
  the research finds with certainty joins the catalog.
- A photographed product is looked for in the shared catalog by name, and only a match the model
  confirms by comparing photos is used.
- Every shot is read for a barcode before anything is paid for, zoomed on the product. The same
  barcode twice is the same product; a known barcode gives the exact name, and the catalog's photo
  counts as certain.
- New shooting flow: photos are kept as taken and all shots go to one product until "+". Only then
  does anything run, from all the photos. Near copies keep the sharper shot, another barcode starts
  a new product, and the background is removed only if no clean image of the product exists.
- Naming gives a brand only if it can be read on the product.
- The catalog keeps the whole research of a barcode, so the next shop gets the same names,
  description and shop links for free. A reused answer never makes a product poorer.
- Shop links are opened before they are shown: only a page that names the product is kept.
- The microphone stays closed while shooting and opens for 12 seconds after "+".
- Video import: a sales video from the phone becomes products. The file stays on the phone; the AI
  gets what was said and one picture of 12 frames, and the merchant confirms each product.
- Stock count: a partial count is flagged, each shelf can use another category, and the + button
  always moves the count.

## 2026-11-05

- Open source: the license is back to AGPL-3.0 (`LICENSE`, `"license": "AGPL-3.0-only"` in
  `package.json`), the repository is public and renamed `tadasouk`. Stripe is listed in the README
  as an existing external payment service, next to Tchentchen.

Card payments through Tchentchen's public API and SDK (Tchentchen existed before the hackathon;
none of its code is in this repository).

- `src/lib/server/tchentchen.ts` rewritten from Tchentchen's public API reference: payments
  (create, read, list by order, cancel, refund) with the secret key in `x-api-key`, and events
  checked with HMAC-SHA256 over the raw body. The guessed checkout API, its webhook secret and
  its Standard Webhooks check are gone.
- Checkout: Stripe's card form shows in the page through Tchentchen's SDK (script tag). The
  server creates a payment for an order id it chooses, the order is placed under that id only if
  the payment matches its total, then the card is charged. A new total makes a new payment. If
  the form cannot load, the buyer goes to Tchentchen's pay page.
- `/api/pay/webhook` records money only after reading the payment back from Tchentchen, once per
  payment, and keeps the ids of handled events. The thank-you page also reads an unpaid card
  order's payments and offers "Payer par carte".
- In-shop QR: the QR is the payment's pay page; its metadata proves the store, so the ticket is
  gone; Cancel cancels the payment.
- Cancelling a paid card order refunds it.
- `/admin/tchentchen`: "Connect Tchentchen" fetches the test and live keys once and stores them
  encrypted (AES-GCM). `worker.ts` serves the website check file
  `/.well-known/tchentchen-verification.txt`.
- Migration `20261104120000_tchentchen_payments.sql`: every payment of an order, refunded amounts,
  handled events, the encrypted keys.
