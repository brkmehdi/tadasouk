# SmallStore

A small merchant in Morocco opens this PWA, presses one big record button, films their products
and talks. The store builds itself on screen: each product is cut out of the video, prices and
discounts are set by voice in Darija, French, Arabic or English.

## Built during the hackathon

This repository was started empty for the **Meta Global AI Developer Hackathon** (indie track,
2026-10-26 to 2026-11-04). The first commit is dated 2026-10-27. Everything below was written
during the event; [CHANGELOG.md](CHANGELOG.md) and the commit history give the day-by-day timeline.

Built so far:

- **Live video capture**: one record button, camera and microphone on the phone, auto-capture when
  a product is held still in the centre, a shutter button, and hold-to-frame (hold the screen,
  then resize a frame around the product).
- **Product highlighting and cutouts**: an on-device detector outlines the product in real time;
  SAM 3.1 cuts it out and the phone puts it on a white background with a soft shadow. The same
  product shown twice is recognised and not captured again.
- **Voice agent for pricing and discounts**: short speech chunks are transcribed and an agent
  turns them into actions (set price, discount, rename, description, stock, remove, undo,
  next product) and asks about missing information.
- **Automatic research per product**: name and description, a studio photo, three AI photos from
  other angles, photos from shop pages on the web, and a price check against Moroccan shops
  (lowest, average, highest, suggested price).
- **Product cards, product sheet and photo preview** with a quality score per photo.
- **Barcodes**: read from the video and attached to the product.
- **Sale screen**: scan products at the counter, update stock, send the receipt on WhatsApp.
- **Merchant accounts**: "Continuer avec Google", or an email with a password, or a phone number
  with a code sent on WhatsApp (the merchant writes first, so the reply with the code is free).
  A first visit names the store; the back office opens on the red record button.
- **AI credit per account**: every Meta Model API call is charged to the signed-in account: $2
  given once at sign-up to the first 10 accounts, later accounts activated by the owner in
  `/admin`; a platform daily cap stays as a safety net. One usage row per call.
- **Public store** at `/{slug}`: hero photo (uploaded or made by muse-image-1.0), product pages
  with WhatsApp previews (Open Graph) and schema.org Product data, basket, cash-on-delivery order
  priced by the database; the merchant previews drafts and handles orders in the back office.
- **Merchant back office**: a shop menu (home, products, sales, settings) with the red record
  button in the middle, French and English, a first-visit guide; every filmed product saved as a
  draft (photos on Cloudflare R2), put online by a button or by voice; counter sale with the
  saved products.
- **Database with row level security** (Supabase Postgres): a merchant only reaches the rows of
  their own store, visitors only see what is published; tested in `supabase/tests/`.
- **Design kit** (`design-kit/`): design system, tokens, screenshots and a build prompt.

Planned for the rest of the event, **not built yet**: polish pass, shipping fees, card
payments through TChenTChen, credit book and installment reminders, AI credit top-ups, English on
the camera screen and the store. This list moves up as each
part lands.

## Preexisting components (not part of this submission)

**TChenTChen** is my private payment and checkout service. It existed before the hackathon.

- **Why it is used.** Taking card payments means card processing through Stripe Connect, payouts
  to merchants and legal obligations. These cannot responsibly be rebuilt in nine days. Reusing
  TChenTChen lets this project focus on what is new: turning a phone video into a working store
  with Meta's models.
- **How it is used.** Only through its HTTP API: create a checkout session, redirect the buyer to
  it, receive signed webhooks. None of its code is in this repository. The storefront that will
  call it is not built yet, so no TChenTChen call exists in the code today.
- **Changes made to TChenTChen during the event:**

  [TO FILL FROM HACKATHON_CHANGES.md]

## Meta models used

| Model | What it does in the app | Where it is called |
|---|---|---|
| `muse-spark-1.3` | Live voice agent: turns what the merchant says into tool calls (price, discount, rename, description, stock, remove, undo, next product, questions) | `src/app/api/agent/route.ts` |
| `muse-spark-1.3` | Names and describes each captured product | `src/app/api/identify/route.ts` |
| `muse-spark-1.3` | Finds the whole product under the merchant's finger (hold-to-frame) | `src/app/api/locate/route.ts` |
| `muse-spark-1.3` | Price check with web search from Morocco: lowest, average, highest, suggested price, sources | `src/app/api/price-check/route.ts` |
| `muse-spark-1.3` | Quality score of each product photo | `src/app/api/photo-score/route.ts` |
| `sam-3.1` | Product segmentation (the mask is decoded and composited on the phone in `src/lib/capture/cutout.ts`) | `src/app/api/segment/route.ts` |
| `muse-image-1.0` | Studio photo: new background and shadow, the real product pasted back | `src/app/api/studio-photo/route.ts` |
| `muse-image-1.0` | Three photos of the product from other angles | `src/app/api/better-photos/route.ts` |
| `muse-image-1.0` | The store's hero photo, on request | `src/app/api/store-hero/route.ts` |
| `muse-voice-transcribe-1.0` | Transcription of short speech chunks for the captions and the agent | `src/app/api/transcribe/route.ts` |

All of these go through `src/lib/server/meta.ts`, which adds the API key on the server and
checks the spending caps (`src/lib/server/usage.ts`) before each call. The key never reaches the
browser.

## Development tools

[TO FILL: e.g. Muse Code, Claude Code]

All model calls in the product go to Meta models through the Meta Model API. The one model that
runs outside it is the MediaPipe object detector on the phone (EfficientDet-Lite0, Apache-2.0),
which only draws the live outline and decides when to capture; it sends nothing anywhere.

## How it works

The Cloudflare Worker stays light: it adds the API key, checks the spending caps and passes
responses through. Frame sampling, mask decoding and compositing happen on the phone. When the merchant
stops filming, the raw video goes to R2 in 8 MiB parts through `/api/captures` (signed-in
merchants only, under a key that carries their user id). The platform owner watches or downloads
the videos at `/admin/videos`; they are kept until the owner decides otherwise.

## Design kit

`design-kit/` holds the build prompt (`MUSE_PROMPT.md`), the design system, tokens, and
screenshots of every screen. Start there to rebuild or extend the app.

## Run it locally

Requirements: Node 20.17+ (or 22.9+), a Meta Model API key from [dev.meta.ai](https://dev.meta.ai).

```bash
npm install
cp .dev.vars.example .dev.vars   # then put your MODEL_API_KEY in it
npx supabase start               # local Postgres + Auth in Docker, applies supabase/migrations
npx supabase test db             # row level security and AI credit tests
npm run dev
```

`.env.development.local` holds `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (from
`npx supabase status`); `supabase/.env` holds `SEND_SMS_HOOK_SECRET`, the same value as in
`.dev.vars`. Phone codes show in the dev server's log until the WhatsApp number is connected.

Open http://localhost:3000/capture (Next.js picks the next free port if 3000 is taken). The camera
needs HTTPS on any host other than localhost, so test on a phone through a deployed preview or a
tunnel.

Other commands: `npm run preview` (production build in the Workers runtime), `npm run deploy`,
`npm run cf-typegen` (after changing `wrangler.jsonc`).

## Configuration

| Name | Where | What |
|---|---|---|
| `MODEL_API_KEY` | secret | Meta Model API key. Server only. |
| `AI_FREE_DAILY_USD`, `DAILY_CAP_USD` | `wrangler.jsonc` vars | Free AI allowance per account per day, and the platform's daily cap. |
| `DATABASE_URL` | `.dev.vars` (local) | Postgres for the server; in production the `HYPERDRIVE` binding. |
| `MEDIA_LINK_SECRET` | secret | Signs the admin page's links to filming videos, served by `worker.ts` straight from R2. |
| `SEND_SMS_HOOK_SECRET` | secret | Verifies the phone codes Supabase Auth hands to `/api/auth/sms-hook`. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | build env | Supabase project for sign-in in the browser (the key only allows what row level security allows). |

## License

All rights reserved. The code is visible for the hackathon evaluation only; see [LICENSE](LICENSE).
Third party components keep their own licenses: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Hackathon compliance

- [ ] Public repository (the repository is private for now)
- [x] New work only: history starts 2026-10-27, no code, files or history imported from other projects
- [x] Preexisting components labeled (TChenTChen, above)
- [ ] Demo video opens with the provenance line (the line is in [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md); the video is not recorded yet)
- [x] Every model call over the network uses the Meta Model API
- [x] No secrets committed (`.env*` and `.dev.vars` are ignored; the full history was checked)
