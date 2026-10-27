# SmallStore design system

How SmallStore looks, moves and speaks. Everything here is what the working app uses today
(screens in `screens/`, values in `tokens/`). Rebuild from this and the result should be
indistinguishable from the screenshots.

## 1. Brand

- **Name:** SmallStore.
- **Promise:** "Filmez vos produits et parlez. Votre boutique se construit toute seule."
  Darija: «صوّر السلعة ديالك و هضر، الحانوت كتبني راسها».
- **Who it is for:** a small shop owner in Morocco, on a midrange phone, often over 4G, often
  with one hand busy holding the product. Not a tech user.
- **Languages:** interface in French first; Darija, Arabic and English understood by voice;
  Arabic text shown right to left where it appears (`dir="auto"` on every text that can be Arabic).
- **Icon:** `assets/icon.svg`. A near-black rounded square, a white ring, a red dot: the record
  button itself. No wordmark beyond the name set in the system font.
- **Look in one sentence:** the camera fills the screen; on top of it, frosted glass cards and
  small round controls; anything you edit opens as a clean white sheet in the style of a
  Stripe checkout (hairline fields, one blue button).

## 2. Principles (each one came from testing on a real phone)

1. **The camera is the app.** Video full screen; controls are small and stay at the edges.
2. **Nearly no buttons, no text that is not needed.** No banners when a mode is on: a ring or a
   pulse says it. One line of text at a time, two lines at most, and it fades away.
3. **One thing at a time.** Auto-capture takes one product, then waits for "+". One question at
   a time, only while the merchant is quiet.
4. **The AI fills, the merchant decides the price.** Name, description, category, photos are
   filled in automatically; whatever the merchant edits is theirs and never overwritten. The
   price is never set by the AI: the suggested price waits for one tap ("Utiliser").
5. **Real product pixels.** The default photo is the merchant's own cutout on white. Studio
   photos keep the real pixels; AI and web photos are labeled as such.
6. **Ask before losing work.** Deleting a product always asks first.

## 3. Tokens

All values: `tokens/tokens.json`. In CSS: `tokens/smallstore.css` (Tailwind v4, the app's real
stylesheet).

| Token | Value | Used for |
|---|---|---|
| `ink` | `rgba(26,26,26,.9)` | text on white |
| `ink-2` | `rgba(26,26,26,.7)` | labels, secondary text |
| `ink-3` | `rgba(26,26,26,.6)` | hints, placeholders |
| `soft` | `rgba(26,26,26,.05)` | soft buttons, tiles |
| `line` | `rgb(224,224,224)` | hairline around fields and cards |
| `brand` | `rgb(0,116,212)` | the one main action, links, attach ring |
| `danger` | `rgb(220,39,39)` | delete, errors |
| `ok` | `rgb(36,180,126)` | good score, cheap vs market |
| `navy` | `rgb(10,37,64)` | photo badges |
| record red | `#ef4444` | the record dot only |
| glass | `white / 15%` + blur 24px + 1px `white/20` ring | product cards over video |

**Type:** system font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, …,
"Noto Sans Arabic"`). Sizes 11 / 13 / 14 / 16 / 22 / 28 px. Weights 400 / 500 / 600.
`tabular-nums` on every number. **Fields are 16px, always** (iPhone zooms into smaller ones).

**Radii:** 6px controls and fields · 4px badges · 12px product card (8px photo inside) ·
16px sheets and bubbles · round for every circular control.

**Elevation:** fields and white cards use the hairline + soft shadow
(`0 0 0 1px line, 0 2px 4px rgba(0,0,0,.07), 0 1px 1.5px rgba(0,0,0,.05)`); focus adds the blue
ring (`0 0 0 1px rgb(50,151,211), 0 0 0 3px rgba(50,151,211,.9)`); sheets cast
`0 -12px 40px rgba(0,0,0,.25)`.

## 4. Capture screen layout (phone portrait)

From back to front:

1. Video, `object-fit: cover`, full screen, black behind.
2. Overlay canvas: the glowing outline around the detected product (only while waiting for a
   product), with a small progress arc above it while the product is held still.
3. Framing layer (only while filming): hold ring, dashed frame, handles.
4. Product tray: right edge, `30vw` wide (max 136px), from under the top bar to 10.5rem above
   the bottom. It **lets touches through** except on the cards themselves.
5. Top bar: `REC` pill (black/45, blur, red dot pulsing) top-left. "Vente" pill (white, ink,
   semibold) top-right after filming. Nothing else (latency pill only with `?debug`).
6. Text strip: centered, 6.25rem above the bottom: one bubble at a time.
7. Controls row, bottom, height 5.5rem + safe area:
   - left: **✕** 48px frosted round button, leaves the camera;
   - middle: **record / shutter** 64px ring (3px white ring; before filming the ring is ink on a
     white screen and the dot is red 52px; while filming the dot is white = shutter);
     while the merchant talks, **3 echo rings** expand from it;
   - right: **+** 48px frosted round button, "next product"; when waiting for the next product
     it turns white with ink "+" and a slow halo pulse.
8. Flying shot, shutter flash, sheets and dialogs on top.

## 5. Components

### Product card (tray)
- Frosted glass: `bg white/15`, `backdrop-blur-xl`, `rounded-xl`, `p-1.5`, shadow, 1px
  `white/20` ring. Current product: 2px white ring. Attach mode: 2px brand ring.
- Photo: square, white background, `rounded-lg`, `object-contain`.
  - top-left: 8px brand dot pulsing while the AI works on it;
  - bottom-left: photo count (black/55, 10px) when more than one;
  - bottom-right inside the photo area: **+** 28px round white button (adds a photo to this
    product; brand fill + pulse while armed). No text appears when it is pressed.
- Name line: fixed height 14px, 11px medium white, truncated. Shimmer while unknown.
- Price line: fixed height 20px.
  - price set: white chip, ink 12px semibold, types itself in;
  - suggestion only: dashed white outline chip "≈ 80 DH";
  - discount: old price struck, 10px white/60.
- Close: 24px round black/60 with a thin ✕, top-right corner, overlapping the edge. Opens the
  delete confirmation.
- New card pops in (scale 0.6 to 1) as the flying shot lands; a removed card shrinks and fades;
  a product shown again pulses amber.

### Caption and question bubbles
- One bubble, centered, max width `min(88vw, 24rem)`, 14px, 2 lines max (`line-clamp-2`).
- Heard text: black/55 + blur, white text, fades after 4s. Pending: black/45, white/75.
- Error: white bubble, danger text, 6s. Agent question: white, ink, medium, 9s.
- Missing-info question (price first, then name, then stock): white bubble with the text,
  an optional blue "Mettre 80" button, and a small ✕ "later". Shown only when the merchant is
  not speaking and no other bubble is up.
- While a frame is shown: "Ajustez le cadre, puis appuyez sur le bouton".

### Hold-to-frame
- Hold ring: 64px, black/30 disc, white/35 track, white progress stroke filling in 1s. Drawn
  **92px above the finger** so the finger does not hide it.
- Frame: appears nearly full screen (6% side margins, from 10% to 76% of the height), then
  glides (250ms) onto the product the AI finds under the finger.
  - Dashed 2px white border, everything outside dimmed with black/35;
  - corners drawn as 22px white **crop brackets** (4px, rounded);
  - edge midpoints as 28×4px white bars;
  - every handle has a 44px touch area.
- Gestures: drag inside to move · corner = two sides · edge = one side · two fingers pinch =
  scale around the center (and follow the midpoint) · tap outside or press the shutter = photo.
  "Annuler" pill (black/55, blur) above the frame's top-left corner.

### Shutter feedback
White flash (0.75 to 0, 220ms), a synthesized two-click shutter sound, the captured crop pops
where it was (scale 1.12) then flies into its card (650ms), vibration 30ms.

### White sheets (product sheet, sale screen, confirmations)
- White, `rounded-t-2xl` on phones, max width 512px centered, `max-h 80dvh`, inner scroll.
- Header: 40px thumbnail (ring black/10), title 16px medium truncated, subtitle 12px ink-3
  (category · Arabic name, or "Recherche en cours…"), close 32px round ✕.
- The product sheet grows out of the tapped card (FLIP, 320ms) and shrinks back on close.

### Product sheet content (top to bottom)
1. Photo strip: 84px tiles, `rounded-md`; the main photo has a 2px ink ring; badges bottom-left
   in navy ("Studio", "IA · 3/4", "IA · Côté", "IA · Dos", or the site name); a small round ✕
   top-right; last tile "+ Photo" (soft background). Tapping a tile opens the photo preview.
2. **Nom**: label 14px medium ink-2, field. Under it, the barcode line: either
   "▮▮ 6111234567895 · Modifier" (mono, 13px) when known, or a small blue "+ Code-barres".
3. **Prix (DH)** and **Stock** side by side. Under the price, when empty: "Conseillé : 80 DH"
   (ink-3) with a blue "Utiliser". Then "Marché au Maroc 58 DH – 194 DH" with "Détails".
   Détails opens a white card: Plus bas / Moyenne / Conseillé / Plus haut, a thin bar with the
   suggested mark (brand) and the merchant price (ink dot), the note, up to 5 source links.
4. **Description**: 3-line textarea, filled by the AI.
5. Two soft buttons: "Chercher des photos" · "Vérifier le prix". **No icons, no emoji.**
6. "Supprimer ce produit" centered, 13px, danger.

### Photo preview
Black full screen. Top: "2 / 8" and the source ("Votre photo", "Studio (votre photo, fond
retouché)", "Image IA · Dos", "Photo du web · site.ma"), round close. Middle: swipeable
photos (scroll snap, no scrollbar). Bottom white panel: a 52px **score ring** (green ≥70, ink
≥50, red below) with the score inside, "Qualité bonne/moyenne/…", a one-line tip, four thin
bars (Netteté, Lumière, Cadrage, Fond, each /10), and two buttons: "Mettre en principale"
(primary) · "Supprimer" (secondary, danger text).

### Delete confirmation
Bottom sheet over a black/20 scrim: thumbnail + "Supprimer ce produit ?" + product name,
then two equal secondary buttons "Annuler" · "Supprimer" (danger text). Recording keeps going.

### Sale screen
Top 36% of the height: camera with a dashed scan guide and "Scannez le code-barres", "Retour"
pill. Then a strip of product tiles to tap (72px). Then the lines: thumbnail, name, unit
price, − qty + (soft 32px buttons), line total. Bottom: "Total" and the amount 28px semibold,
"WhatsApp du client (facultatif)" field, primary "Envoyer le reçu sur WhatsApp", text
button "Terminer sans reçu". A bip on each scan.

### Buttons
| Kind | Look |
|---|---|
| primary | brand fill, white 600, inner hairline + soft shadow, a light runs across every 3s |
| soft | `soft` fill, ink 500 |
| secondary | white, hairline + soft shadow, ink-2 (danger text for destructive) |
| link | brand text 500, no background |
All: 6px radius, 40px high (44px in sheets), press = scale 0.98.

### Fields
44px high, 16px text, white, hairline + soft shadow, blue focus ring, placeholder ink-3.

## 6. Interface text (French, as shipped)

Start: "Filmez vos produits et parlez" · "Montrez un produit au centre, puis dites son prix.
Exemple : « hada b miya », « 20% de remise »."
Camera: "REC" · "Préparation…" · "Touchez un produit pour le prendre" ·
"Maintenez le doigt sur un produit pour le cadrer" · "Ajustez le cadre, puis appuyez sur le
bouton" · "Annuler" · "Code-barres ajouté : 6111…" · "Déjà dans la boutique : …".
Questions: "Prix de « X » ? Conseillé : 80 DH" [Mettre 80] · "Quel est le prix de « X » ?" ·
"Comment s’appelle ce produit ?" · "Combien de « X » avez-vous ?".
Cards: "Sans nom" · "Prix ?" · "≈ 80 DH".
Sheet: "Nom" · "+ Code-barres" · "Modifier" · "Ou montrez le code-barres à la caméra." ·
"Prix (DH)" · "Stock" · "Conseillé : 80 DH" · "Utiliser" · "Marché au Maroc" · "Détails" ·
"Masquer" · "Description" · "Écrivez, ou dites « la description : … »" · "Chercher des photos" ·
"Vérifier le prix" · "Supprimer ce produit".
Confirm: "Supprimer ce produit ?" · "Annuler" · "Supprimer".
Sale: "Vente" · "Retour" · "Scannez le code-barres" · "Scannez ou touchez un produit." ·
"Total" · "WhatsApp du client (facultatif)" · "Envoyer le reçu sur WhatsApp" ·
"Terminer sans reçu" · "Vente enregistrée." · "Code 6111… : produit inconnu".
Receipt (WhatsApp, bold with asterisks):
```
*Reçu — Ma boutique*
27/10/2026 20:39

1 × Huile d'Argan 30ml — 80 DH
2 × Thé vert 100g — 30 DH

*Total : 110 DH*
Merci pour votre achat !
```
Camera help (iPhone): "Autorisez la caméra et le micro" with steps
"Ouvrez Réglages › Chrome, activez Caméra et Microphone." …

Rules for new text: plain words, short, French; no emoji; no exclamation marks except the
receipt's thank-you; numbers with "DH" after a space; « » quotes for product names.

## 7. Screens

| File | What it shows |
|---|---|
| `screens/01-start.png` | white start screen, small record button |
| `screens/02-capture-question.png` | camera, first product auto-captured into the tray, price question, ✕ / shutter / + |
| `screens/03-hold-ring.png` | finger held on the video, ring filling above it |
| `screens/04-hold-to-frame.png` | dashed frame with crop brackets around the product, hint, Annuler |
| `screens/05-confirm-delete.png` | delete confirmation sheet |
| `screens/06-product-sheet.png` | product sheet: photos with badges, auto-filled name and description, + Code-barres, suggested price with Utiliser, market range |
| `screens/07-photo-preview-score.png` | full-screen photo preview with the quality score |
| `screens/08-sale-receipt.png` | sale screen with two lines, total, WhatsApp receipt button |

`scenes/` holds the two shop photos (generated with muse-image-1.0) used as a stand-in camera
for these screenshots and for demos.

## 8. Accessibility and motion

- Every icon-only button has a French `aria-label`.
- Touch targets 44px minimum (handles, close buttons have larger invisible areas).
- Contrast: white on video always sits on a dark translucent layer or carries a shadow.
- `prefers-reduced-motion`: all decorative animations off.
- Arabic and Darija text: `dir="auto"`; layout uses logical properties (`start`/`end`).
