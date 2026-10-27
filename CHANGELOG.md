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
- `docs/DEMO_SCRIPT.md`: the provenance sentence the demo video opens with, and the outline.
- Checked the full git history: no API key or other secret was ever committed.
- Product tray: with many products the column now scrolls on iPhone (it used to cut the last
  card and not move). It is only as tall as its cards, fades the edge where more cards are
  hidden, and scrolls back to the current card after each capture (`ProductTray.tsx`).
