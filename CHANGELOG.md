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
- Live preview on Cloudflare Workers. Cache Components turned off: it hangs in the Workers runtime.
- Latency panel on the record screen: first highlight, detector time per frame, capture to card,
  spoken command to UI update.
