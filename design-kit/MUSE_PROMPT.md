# Build prompt: SmallStore

You are building **SmallStore**, an open source mobile web app (PWA) for the Meta Global AI
Developer Hackathon (indie track). Read this whole file before writing code. It describes a
version that already works and was tuned on real phones; every rule below exists because a
simpler version failed in testing. Where this file says "must", do not simplify it away.

Attached with this prompt:
- `DESIGN_SYSTEM.md`: the visual system, components, motion and French interface text.
- `tokens/smallstore.css` (the stylesheet, Tailwind v4) and `tokens/tokens.json`.
- `screens/01…08.png`: what each screen must look like (390×844 phone, @1.5x).
- `scenes/*.webp`: two shop photos to use as a stand-in camera while testing.
- `assets/icon.svg`: the app icon.

---

## 1. The product in one paragraph

A small shop owner in Morocco opens the app on their phone, presses one button, films their
products and talks. The store builds itself on screen: each product is cut out of the video
onto a white background, named, described, photographed from other angles, priced against
the Moroccan market and placed in a tray, while the merchant sets prices and discounts by voice
in Darija, French, Arabic or English. Barcodes are read on the fly. After filming, a sale
screen lets the merchant scan products at the counter and send the receipt on WhatsApp.

## 2. Hard rules (from the hackathon brief, non-negotiable)

1. New public GitHub repository (the owner may keep it private during the build), all code
   written during the hackathon, an all-rights-reserved `LICENSE` (no open source license), a `README.md` that says what was built
   during the hackathon, a `CHANGELOG.md` updated every day, commits at least daily.
2. All intelligence runs on the **Meta Model API** (`https://api.meta.ai/v1`, OpenAI
   compatible): `muse-spark-1.3` for reasoning and tool calls, `sam-3.1` for segmentation,
   `muse-image-1.0` for images, `muse-voice-transcribe-1.0` for speech. Read
   https://dev.meta.ai/docs (every page has a `.md` version, e.g. `/docs/sam/segmenting.md`)
   and **never guess an endpoint or a parameter**.
3. API keys stay on the server, never in the browser. Locally in `.dev.vars` (git-ignored),
   in production as a Cloudflare secret (`MODEL_API_KEY`).
4. Hard spending caps per capture session and per day, checked before every Meta call, and
   one usage log line per call.
5. The TChenTChen card checkout is a preexisting product: only link to it from the storefront
   and label it as such; do not include its code.
6. Stack: Next.js (App Router, TypeScript) on **Cloudflare Workers free plan** via the
   **OpenNext Cloudflare adapter**; Tailwind; PWA manifest and service worker. Supabase
   (Frankfurt or Paris) for Postgres with row level security and email magic link auth only,
   reached from Workers through Hyperdrive with caching off; no Supabase Storage. Cloudflare R2
   for all media, uploaded by the browser with short-lived signed URLs; video bodies never pass
   through the Worker; raw capture videos deleted after 7 days.
7. Keep the Worker light (free plan CPU is tiny): **no image or video processing on the
   server**. Pixels are handled in the browser; heavy model work in the Meta API. The Worker
   adds the key, checks caps, and streams responses through.
8. Mobile first, right to left for Arabic.

## 3. Stack and layout that work

- Next.js 16 App Router + TypeScript, Tailwind CSS v4, `@opennextjs/cloudflare` 1.20+,
  `wrangler` 4.x. **`cacheComponents` must stay off**: with it on, every page hangs in the
  Workers runtime (Error 1101).
- `wrangler.jsonc`: `main: .open-next/worker.js`, `compatibility_flags: ["nodejs_compat",
  "global_fetch_strictly_public"]`, assets binding, vars `MODEL_API_BASE`,
  `SESSION_CAP_USD` (1.50), `DAILY_CAP_USD` (10.00), `R2_BUCKET_NAME`. Secrets:
  `MODEL_API_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
- `next.config.ts` calls `initOpenNextCloudflareForDev()` so `next dev` sees bindings and
  `.dev.vars` through `getCloudflareContext()`.
- Browser libraries: `@meta-sam/parser` (decode SAM output), `@mediapipe/tasks-vision`
  (on-device object detector, EfficientDet Lite0 float16, wasm from jsDelivr pinned to the
  installed version), `zxing-wasm` **3.1.4** reader (barcodes; serve
  `zxing_reader.wasm` from `/public` and point `locateFile` at it), `aws4fetch` on the server
  for R2 presigned PUT URLs.

```
src/app/
  page.tsx                 white home, small record button linking to /capture
  manifest.ts, icon.svg    PWA
  ServiceWorker.tsx        registers /sw.js in production only
  capture/
    page.tsx               renders CaptureScreen
    CaptureScreen.tsx      camera, detection loop, capture pipeline, voice, tray, controls
    FrameOverlay.tsx       hold-to-frame (own state, see §6.5)
    ProductCard.tsx        frosted card in the tray
    ProductSheet.tsx       white product sheet
    PhotoViewer.tsx        full-screen photo preview with quality score
    ConfirmRemove.tsx      delete confirmation sheet
    SellMode.tsx           sale screen with scanner and WhatsApp receipt
  api/
    segment/        sam-3.1                       (stream passthrough)
    transcribe/     muse-voice-transcribe-1.0
    agent/          muse-spark-1.3 tool calls
    identify/       muse-spark-1.3 vision, JSON   (name from the photo)
    locate/         muse-spark-1.3 grounding      (product box under a finger)
    price-check/    muse-spark-1.3 + web_search   (identity + prices in Morocco)
    better-photos/  muse-image-1.0 edits          (one angle per call, stream passthrough)
    studio-photo/   muse-image-1.0 edits          (backdrop only, stream passthrough)
    photo-score/    muse-spark-1.3 vision, JSON   (quality score)
    web-photos/     reads shop pages' product image (no model)
    upload-url/     R2 presigned PUT for the raw video
    usage/          spend so far
src/lib/server/  meta.ts (fetch helper, responsesJson, errors), usage.ts (prices, caps, log)
src/lib/capture/ session.ts, detector.ts, cutout.ts, similarity.ts, voice.ts, barcode.ts,
                 media.ts, product-actions.ts, sfx.ts, metrics.ts
```

### Deployment (read before running any deploy command)

- An earlier build of this app is already live as the Worker **`smallstore`** at
  `https://smallstore.smallstore-app.workers.dev`. **Never deploy under that name**: it would
  replace the working app.
- Name this Worker **`smallstore-muse`** in `wrangler.jsonc`. It will be served at
  `https://smallstore-muse.smallstore-app.workers.dev`.
- Cloudflare account: "Meta Hackaton", `account_id: "d57fb66226e5bda27248ba2c4d62077a"`
  (set it in `wrangler.jsonc`; the login on this machine has several accounts and a deploy
  without it fails). The workers.dev subdomain `smallstore-app` already exists: do not change
  it.
- Set the secret for this Worker before testing: `npx wrangler secret put MODEL_API_KEY`
  (secrets belong to each Worker; the live app's secret does not carry over).
- Do not create custom domains, routes, DNS records or new subdomains, and do not delete or
  modify other Workers on the account. Ask the owner before any deploy.

## 4. Meta Model API: the exact calls

Base `https://api.meta.ai/v1`, header `Authorization: Bearer $MODEL_API_KEY`.

**Segmentation, `POST /responses`, model `sam-3.1`.** One user message with an
`input_text` prompt and an `input_image` (`image_url` = `data:image/jpeg;base64,…`).
- Prompt grammar for boxes and points: `<0f>1<|box;x1=..;y1=..;x2=..;y2=..;w=W;h=H|>` and
  `<|point;x=..;y=..;w=W;h=H|>`; build it with `buildObjectPrompt` from `@meta-sam/parser`
  (box `right`/`bottom` are exclusive). Coordinates in the image's own pixels; `w`/`h` must
  match its aspect ratio or you get a 400.
- `stream: true`, `metadata: { include_confidence: "true" }` (string, not boolean).
- The Worker returns `upstream.body` untouched as `text/event-stream`; the browser reads the
  SSE lines and feeds the JSON events to `parseImageStream(...).finalResult`, then
  `recordsOfKind(records, "mask")`, `decodeMaskToRaster(mask.mask)` → row-major 0/1 of
  `mask.height × mask.width` covering `mask.bounds` (half-open box in source pixels).
- A word prompt ("product") returns nothing; only concrete nouns work ("bottle"). A point
  alone returns the **part** under it (the label, not the bottle). Several objects in one
  request get **exclusive pixels** (nested prompts carve holes in each other).
- Price: $2.50 per 1,000 images.

**Speech, `POST /asr/transcribe`.** `multipart/form-data` with a `request` part
(JSON: `{"model":"muse-voice-transcribe-1.0","audioEncoding":"WAV","mode":"PUSH_TO_TALK",
"languageBias":["Arabic","French","English"],"keywords":["hada","hadi","hadou","dirham",
"drahem","euro","promo","remise","taman","bghit"]}`, type `application/json`) and an `audio`
part (WAV, mono, 16-bit PCM, 16 kHz). Response `{ transcript, audioDurationMs, turns }`.
Darija is not in the supported list; Arabic bias plus the agent's prompt cover it. $0.18 / hour.

**Agent, `POST /chat/completions`, model `muse-spark-1.3`.** `reasoning_effort: "low"`
(`"minimal"` gives the same calls about 0.6 s faster; `"none"` is a 400),
`max_completion_tokens: 600`, `tools`, `tool_choice: "auto"` (the **only** accepted value),
`parallel_tool_calls: true`. Read `choices[0].message.tool_calls[].function.{name,arguments}`.

**Structured answers with image input, `POST /responses`, model `muse-spark-1.3`.**
`reasoning: { effort: "low" | "minimal" }`, `text: { format: { type: "json_schema", name,
strict: true, schema } }`, `input: [{ role: "user", content: [{type:"input_text",…},
{type:"input_image", image_url}] }]`. Take the last `output_text` of the `message` items.
**`max_output_tokens` counts reasoning tokens**: 800 truncated the JSON; use 1500 to 2500.
Web search: add `tools: [{ type: "web_search", search_context_size: "low", user_location:
{ type: "approximate", country: "MA" } }]` (Responses API only, not Chat Completions); count
`web_search_call` items for cost ($2.50 / 1,000 searches). Tokens: $1.25 / M input,
$0.15 / M cached, $4.25 / M output.

**Images, `POST /images/edits`, model `muse-image-1.0`.** JSON body
`{ model, prompt, images: [{ image_url: dataURL }], n, size: "1024x1024",
reasoning_strength: "low", stream: true }`; optional `tool_enablement: { enable_image_search,
enable_web_search, enable_shell }` (search is built in; never pass a `web_search` tool). The
stream ends with `event: image_edit.completed` carrying `b64_json` (WebP). Stream it through
the Worker untouched; decode in the browser. $0.01 per image, about 9 to 11 s.
`POST /images/generations` takes the same model, `size` sets only the aspect ratio
("1024x1792" for portrait).

## 5. Spending caps and usage log (server)

`usage.ts`: a ledger with `reserve(caps, sessionId, model, endpoint, estimateUsd)` called
before every call (throws a `SpendingCapError` → HTTP 402 with a French-readable message when
the session or the UTC day would go over) and `settle(reservation, realCost, ok, detail)`
after (adjusts the totals, logs one JSON line `{ usage: { at, sessionId, model, endpoint,
costUsd, latencyMs, ok, detail } }`). Estimates: SAM one image; ASR from the WAV length;
chat from prompt length + max tokens; price check $0.15; image $0.01 per image. The ledger
lives in memory today (per isolate); in Phase 1 move it to a Postgres `api_usage` table so
the caps hold across isolates. `/api/usage?sessionId=` returns the totals.

## 6. Capture screen: exact behavior

### 6.1 Start
- White start screen (screen 01): title, Darija line, one hint, small record button.
- On tap, **before any `await`**: create the `AudioContext` (iOS keeps a later one silent).
  Then `getUserMedia({ video: { facingMode: "environment", width: {ideal:1280},
  height: {ideal:720} }, audio: { echoCancellation, noiseSuppression, channelCount: 1 } })`.
- Only the camera is required. MediaRecorder (mp4 if supported, else webm, 2.5 Mbps), voice,
  and the screen wake lock each fail quietly with a short caption.
- Camera errors become a help card with steps (`media.ts`): NotAllowed on iPhone → "Ouvrez
  Réglages › Chrome (or Safari), activez Caméra et Microphone"; in-app browsers (WhatsApp,
  Instagram) → open in Safari/Chrome; NotReadable → close the other camera app.
- The video element is `muted playsInline autoPlay`, set `video.muted = true` in code too.

### 6.2 Controls (screen 02)
- Middle button: before filming it starts; **while filming it is the shutter** (white dot).
  Shutter picks, in order: the frame if one is shown; the detector's product **if its box
  covers the image center**; else a 60% center box with a point at the center (goes through
  `locate`, §6.6).
- Left ✕: stop filming (stops recorder, voice, tracks, wake lock).
- Right +: "next product" (arms auto-capture). Pulsing white while armed. No text.
- While the merchant talks, three echo rings expand from the middle button.

### 6.3 Detection and auto-capture
- MediaPipe ObjectDetector in VIDEO mode, GPU delegate with CPU fallback, `scoreThreshold
  0.25`, `maxResults 6`, `categoryDenylist` of furniture/people (person, dining table, chair,
  couch, bed, tv, refrigerator, oven, toilet, sink, car, bus, truck, potted plant, bench,
  laptop). Run every 66 ms. Pick the best `score × centrality`, sticky (+30% if it overlaps
  the previous pick).
- **Auto-capture takes one product, then waits.** `armed` is true at start and after "+"
  (or the agent's `next_product`); any new capture sets it false. While not armed: no
  outline, no auto-capture, and "hada" does not capture.
- Stillness trigger: the target's box must **cover the center of the picture**
  (x from ≤56% to ≥44% of the width, same for height; a jar on a shelf behind is not the
  product), stay within 4.5% of the diagonal and ±25% area for **800 ms**, cooldown 2.5 s,
  not re-fire on the same object until it leaves. Draw a glowing rounded outline (yellow
  shadow) and a small white progress arc above it while holding.
- Known limit: the detector only knows COCO objects (bottles, cups, phones…); a box of tea is
  not detected, so the shutter and hold-to-frame are the way for those. Possible upgrade:
  confirm the held product with MediaPipe hand landmarks or muse-spark grounding.

### 6.4 Capture pipeline (every capture)
1. Grab a keyframe (video drawn to a canvas, longest side ≤ 1024) and the box in its pixels.
2. **Duplicate check before SAM:** fingerprint the central 70% of the box (`similarity.ts`:
   16-bin soft hue histogram of saturated pixels + 3 brightness bins for grey pixels relative
   to the frame mean, and an 8×8 difference hash; score = 0.7 × histogram intersection +
   0.3 × hash agreement). If a product in the tray scores ≥ **0.74**, do not create a card:
   select that product, pulse its card, vibrate twice. (Tested: same product moved, tilted 30°,
   darker or warmer light 0.72 to 0.88; different products 0.18 to 0.40; a look-alike 0.66.)
3. Shutter feedback: flash, synthesized click (two filtered noise bursts), vibrate, the crop
   pops where it was and **flies into its card** (§DESIGN 5). Create the card at once with the
   crop blurred under a shimmer; `addCaptured` makes it the current product.
4. `/api/segment` → mask → composite in the browser: transparent PNG cutout (kept for studio
   photos) and the **default photo: the cutout on white, square 1024, product at 78% centered
   slightly high, a soft flat radial shadow under it**. Dominant color name for "the red one".
5. Duplicate check again on the cutout (alpha pixels only), threshold **0.76**: if it matches
   another product, drop the new card and select the old one.
6. Start the research (§7) at once for new products; a photo added with "+" gets its studio
   version only.

### 6.5 Hold to frame (`FrameOverlay.tsx`, screens 03, 04)
- Own component with its own state: a drag must only re-render the frame, never the whole
  capture screen (that made resizing feel slow).
- Finger resting still on the video (moves < 14 px): a 64px ring fills in **1 s**, drawn
  **92 px above the finger** so it is visible. A quick tap only shows "Maintenez le doigt sur
  un produit pour le cadrer".
- After 1 s: vibrate, show a **nearly full-screen frame** (x 6%, width 88%, y 10%, height 66%;
  a big frame needs fewer corrections), then ask `locate` for the product under the finger and
  glide the frame onto it (250 ms) unless the merchant already touched the frame. Still
  holding and moving the finger moves the frame.
- Gestures: drag inside = move; 4 corner brackets and 4 edge bars, each with a 44 px touch
  area (edges change one side); two-finger pinch scales around the center and follows the
  midpoint; minimum 64 px; clamped to the screen. Tap outside or press the shutter = photograph
  what is inside (SAM box prompt = the frame). "Annuler" above the top-left corner.
- While a finger holds or a frame shows, auto-capture pauses. Text "Ajustez le cadre, puis
  appuyez sur le bouton" only once the frame is visible.
- Pointer capture is best effort (wrap `setPointerCapture` in try/catch).

### 6.6 Finding the whole product under a finger (`/api/locate`)
A point on a label made SAM cut out the label; a big box made it cut out the wall. The fix
that works: send a ≤768 px JPEG and the point (0-1000) to muse-spark-1.3, `reasoning
minimal`, schema `{ noun, x_min, y_min, x_max, y_max }` (0-1000): "A shop owner tapped the
point (x, y) … Return the whole product they mean (not only its label or a part of it)". About
1.6 to 2.4 s, accurate to a few pixels. Accept it only if the box contains the point (±30);
pad 3%; then SAM with that box **and** the point. If locate fails, fall back to one SAM request
with the point alone plus three boxes of 25/35/55/80% of the short side around it; keep the
most confident mask, prefer the smaller one when confidences are within 0.03, and merge back
every mask nested inside it (pixels are exclusive across objects in one request).

### 6.7 Barcodes
- Every 700 ms while filming, read the live video (native `BarcodeDetector` if available,
  else zxing-wasm reader, formats EAN13, EAN8, UPCA, UPCE, Code128, `tryHarder`,
  `tryRotate`, one symbol; reads take 2 to 13 ms after a one-time warm-up).
- A code goes to the current product if it has none (bip, card pulse, "Code-barres ajouté : …").
  If another product already has it: select that product, and drop a card created in the last
  8 s for the same item. **Ignore a code for 4 s only after acting on it** (ignoring it before
  meant a barcode seen before the capture was never attached).

### 6.8 Voice
- AudioWorklet tap at the device rate, box-filter downsampled to 16 kHz in the app; 20 ms
  frames; energy VAD (threshold max(0.012, 3 × noise floor)); speech opens after 80 ms,
  240 ms pre-roll, closes after 500 ms silence or 7 s; chunks under 300 ms dropped; WAV built
  in the browser; one request per chunk, processed in order.
- On speech start, snapshot a keyframe. If the transcript contains a cue ("this one", "hada",
  "hadi", "hadou", "celui-ci", "ceci", هادا, هذا…) **and** a new product is expected (armed)
  and nothing was captured during this sentence, capture from that snapshot.
- Send the transcript and a compact state to `/api/agent`; apply the tool calls; run effects.

### 6.9 Text on screen
One bubble at a time, centered, two lines max, heard text fades after 4 s (errors 6 s, agent
questions 9 s). Priority: latest caption, else the frame hint, else one question about what is
missing for the current product (price first, with "Mettre 80" when a suggestion exists, then
name, then stock), only when the merchant is not speaking and not waiting for the next
product. ✕ on a question = later. After filming stops, questions walk through the products.

## 7. Research per product (automatic, right after the cutout)

1. **Name from the photo** (`/api/identify`, 512 px JPEG of the white photo, schema
   `{ name_fr, name_ar, category, description_fr, confident }`, 3 to 4 s): fill name (even if
   not confident: a draft beats "Sans nom"), Arabic name, category; description only if
   confident.
2. **Studio photo** (`/api/studio-photo`): send the cutout on white (same layout as the white
   photo); prompt "Replace only the plain white background with a clean, light photo-studio
   backdrop … add a soft natural contact shadow … Do not change the product in any way …";
   search tools off. In the browser, paste the real cutout back on top and run the
   **fidelity check**: sample opaque cutout pixels, compare RGB (sum of differences < 90), try
   offsets of ±24 px in 4 px steps (the model nudges the product), keep the best; accept if
   ≥ 0.80 and paste at that offset; otherwise drop the studio photo silently.
3. **Three angles** (`/api/better-photos`, three parallel calls, one per angle:
   three-quarter, side, back): "Professional e-commerce photo of the exact product shown …
   Show it from … Look up this product online to see its other sides … Keep the product
   identical … If this view makes no sense for this kind of product, show it held in a hand or
   in use instead … Plain light studio background …". Badges "IA · 3/4", "IA · Côté", "IA · Dos".
4. **Identity and prices** (`/api/price-check`, web search from Morocco, schema
   `{ product, name_fr, name_ar, description_fr, category, currency, low, average, high,
   suggested, verdict, note, sources[{title,url,price}] }`; "Sources must be pages of this
   exact product in a shop (not a store home page, a category or a search page)"; note in
   French; about 15 s, about $0.08). The web name and description **replace** the photo guess
   in fields the merchant has not edited.
5. **Real web photos** (`/api/web-photos`, after step 4): fetch up to 5 source pages (5 s
   timeout, first 200 KB), take the schema.org Product image or `og:image`/`twitter:image`,
   reject logos, banners, `opengraph` images and images at the site root, force https, dedupe;
   add up to 3, badge = site name. These belong to other shops: the merchant decides.

Auto-fill rule: a product keeps `aiFilled: { name, description }`. AI results write into a
field only if it is empty or was AI-filled; any merchant edit (sheet or voice) sets the flag
false. **The price is never written by the AI**: it shows as "≈ 80 DH" on the card and
"Conseillé : 80 DH · Utiliser" in the sheet, and the question bubble offers "Mettre 80".

Photos are drawn to canvases only when they are the merchant's own (camera, studio); web
photos are cross-origin and are scored by URL.

## 8. Session state and the agent

Product: `{ id, order, name, aiFilled, nameAr, category, barcode, label, color,
images[{ id, url, source: camera|studio|ai|web, pending, cutoutUrl?, credit?, quality? }],
description, price, compareAtPrice, currency, quantity, question, status:
active|failed|removing, identify, research, photos, priceCheck, capturedAt }`. Session:
`{ currency: "MAD", products, currentId, history }` (history = up to 30 snapshots for undo;
undo restores names, prices and descriptions but keeps photos and research that arrived since).

Agent tools (JSON schema, all with `product_id` resolved from the state, except where noted):
`create_product(name, price?, quantity?)`, `set_price(amount, currency? MAD|EUR)`,
`apply_discount(kind percent|amount, value)` (base = compareAtPrice ?? price; keeps the old
price struck), `rename_product(name)`, `set_description(description)`,
`set_quantity(quantity)`, `remove_product`, `undo_last`, `find_better_photos`,
`check_price`, `next_product` (no product), `accept_suggestions` (uses the suggested price),
`ask_merchant(question, product_id?)`.

Agent system prompt (use as is):
```
You run the voice controls of a shop being built live on a phone in Morocco.
The merchant films products and talks in Darija, French, Arabic or English, often mixed.
You receive one transcript chunk and the session state. Respond ONLY with tool calls.
If the chunk is small talk or not about the products, call no tool and reply with an empty message.
"this one", "hada", "hadi", "celui-ci" mean the current product. "the previous one", "lli 9bel" mean the product captured just before it.
Numbers can be spoken in Darija (miya = 100, mitayn = 200, khamsin = 50, alf = 1000) or French.
Never invent a product id; use ids from the state. If you are unsure, call ask_merchant.
The state may carry an openQuestion the app just asked the merchant (for example the price, with a suggestedPrice on that product). A short "oui", "wakha", "ok" or "yes" answers it: for a price question, call set_price with the suggestedPrice of that product. A number answers it with that number.
```
The state sent: `{ currency, currentId, recent (last 5 ids), products[{ id, name, label,
color, price, compareAtPrice, quantity, description, photos, suggestedPrice }],
openQuestion }`. Tested: "hadi lhamra b mitayn, w lli 9bel 7ydha" → `set_price 200` on the
current product and `remove_product` on the previous one.

UI reactions: the price chip types itself in; a discount strikes the old price; a removed card
shrinks and fades; an unsure agent puts "?" on the card and asks in the bubble. Never open a
modal on your own while filming (the merchant's own taps may open sheets).

## 9. Cards, sheets, viewer, sale (see DESIGN_SYSTEM.md §5 for visuals)

- **Card +**: arms auto-capture and routes **the next photo** (auto, shutter or frame) to that
  product, then the mode ends by itself. Brand ring + pulsing "+"; no text.
- **Card ✕** and "Supprimer ce produit" open the confirmation; never delete on one tap.
- **Card tap** opens the product sheet (grows from the card, recording continues, the product
  becomes current so voice applies to it).
- **Sheet**: photos (tap = preview), name, barcode line (only when known, else "+ Code-barres";
  "Ou montrez le code-barres à la caméra." when editing), price + stock, suggested price with
  Utiliser (only when the price is empty), market range with Détails, description, "Chercher
  des photos", "Vérifier le prix", "Supprimer ce produit". "+ Photo" closes the sheet and arms
  the next photo for this product.
- **Photo preview**: swipe, source label, quality score from `/api/photo-score` (schema
  `{ score 0-100, sharpness, lighting, framing, background 0-10, note }`, reasoning minimal,
  computed the first time a photo is shown, cached on the image), "Mettre en principale",
  "Supprimer".
- **Sale** ("Vente" after filming): own camera (video only), scan every 400 ms, same code held
  in view counts once (1.5 s), unknown code notice, products to tap, − / + quantities, total,
  optional WhatsApp number (06/07… → 2126/2127…), receipt via
  `https://wa.me/<number>?text=<encoded receipt>` (format in DESIGN_SYSTEM.md §6), then lower
  the stock of products that have one. No price → "Ajoutez d’abord un prix à « … »".

## 10. iPhone and mobile details that matter

- Every input, textarea and select is **16px**, plus a guard
  `@supports (-webkit-touch-callout: none) { input, textarea, select { font-size: 16px !important } }`;
  smaller fields make Safari zoom the page and it looks wider than the screen.
- The tray column must have `pointer-events: none` with its cards `pointer-events: auto`, or
  it blocks touches on the right third of the video even when empty.
- Hide scrollbars on swipe strips. `touch-action: none` on the framing layer. Safe-area insets
  on top bar, controls and sheets. Web Audio sounds follow the silent switch on iPhone.
- The camera needs HTTPS outside localhost: test on a real phone through the deployed
  workers.dev preview.

## 11. Measured numbers (phone over 4G and desktop)

SAM 0.5 to 1.2 s per keyframe · capture to card with cutout about 1.1 to 2.5 s · transcription
about 3 s per chunk · agent about 2 to 3 s (speech to UI about 5 to 6 s, above the 3 s target;
next step: realtime ASR over WebSocket so the text is ready when the merchant stops) ·
identify 3 to 4 s · locate 1.6 to 2.4 s · price research 15 s · each image 9 to 11 s.
Cost per product with full research about $0.14; per photo score about $0.002.

## 12. Iteration log (decision and why)

| Decision | Why |
|---|---|
| One product per auto-capture, "+" for the next | the camera kept grabbing things while the merchant talked about the current product |
| Detected product must cover the image center | auto-capture and the shutter grabbed a jar on a shelf behind the held box |
| Middle button becomes the shutter, ✕ left, + right | people reflexively press the middle button to take a photo |
| Hold 1 s to frame, ring 92 px above the finger | the ring was hidden under the finger |
| Frame starts nearly full screen, then snaps to the product | a small frame always needed resizing |
| Frame in its own component, pinch, 44 px handles, edges | resizing felt heavy when the whole screen re-rendered |
| `locate` before SAM for taps | a point on the label cut out only the label |
| AI fills fields directly, no "Tout utiliser" | nobody accepts what they have not seen; editing what you dislike is faster |
| Price never auto-set; one tap "Utiliser" | the price is the merchant's decision |
| White background + soft shadow by default | clean shop photos without any AI touching the product |
| Studio photo pastes real pixels back + fidelity check | the product must stay exactly what the camera saw |
| Three AI angles + real web photos, labeled | merchants want several angles; honesty about what is generated |
| Photo preview with quality score | helps choose the main photo |
| Delete asks first | accidental deletions on small cards |
| One centered bubble, 2 lines, fades | stacked captions covered the video and the cards |
| No banner text for modes ("+" on a card) | text in the middle of filming disturbed the merchant |
| Barcode line only when known | most products have none; the field must not take space |
| Visual fingerprint dedupe (hue + dHash) | RGB histograms failed under light changes |
| 16 px fields on iOS | Safari zoomed the page on focus |
| AudioContext created in the tap | iOS kept audio started later silent |
| Cache Components off | pages hung in the Workers runtime |
| Fidelity check with ±24 px offsets | the model nudges the product by up to about 12 px |
| identify max tokens 2500 | reasoning tokens count; 800 truncated the JSON |

## 13. Still to build (Phase 1 of the brief)

- Supabase (Frankfurt/Paris): merchants, stores, products, capture_sessions, customers,
  orders, order_items, installment_plans, installments, api_usage; RLS; magic link auth;
  Hyperdrive with caching off. Persist the session products (today they live only in the open
  page, so sales work only within a session).
- R2 bucket with a 7-day lifecycle rule on `captures/`, CORS for browser PUT, store cutouts and
  generated images there instead of blob URLs.
- Review screen (grid, swipe to delete, tap to edit, Publish → store link, QR code, WhatsApp
  share), storefront (header, grid, product page, cart, checkout: cash on delivery with name,
  phone, autofilled country and city, optional location on click; credit request with the
  installment preview; card button linking to the external TChenTChen checkout, labeled), and
  the back office (orders by state, credit book with installments and wa.me reminders,
  products, settings: store name, currency, payment methods, default installment plan, RIB).
- Store name on receipts from settings (today "Ma boutique").

## 14. Done means

- All eight screens match `screens/` on a 390×844 phone.
- A merchant films two products without touching the screen except "+": both appear in the
  tray as cutouts on white, named within 4 s, with three angle photos, web photos, a
  suggested price and a market range within about 30 s.
- Saying "hada b mitayn" sets 200 DH on the current product; "20% de remise" strikes it to
  160 DH; "lli 9bel 7ydha" removes the previous one; "utilise le prix conseillé" applies it.
- Hold, frame, pinch, edge drag and shutter work smoothly on an iPhone; tapping a label
  captures the whole product.
- A barcode shown to the camera attaches to the product; at the sale screen scanning it adds a
  line; the WhatsApp receipt opens with the right number and text.
- Spending caps stop calls with a readable message; every call is logged.
- Type check and lint pass; no field under 16px; no API key in the browser bundle.
