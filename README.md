# SmallStore

A small merchant in Morocco opens this PWA, presses one big record button, films their products
and talks. The store builds itself on screen: each product is cut out of the video, prices and
discounts are set by voice in Darija, French, Arabic or English.

## Built during the hackathon

This project was started from an empty repository for the **Meta Global AI Developer Hackathon**
(indie track) on 2026-10-27. All code in this repository was written during the hackathon.
[CHANGELOG.md](CHANGELOG.md) lists what was built each day.

The "Pay by card" option of the storefront links to the TChenTChen card checkout, a separate
product that existed before the hackathon. Its code is not part of this repository.

## How it works

| Step | Where it runs | Model |
|---|---|---|
| Live outline around the product | Phone (MediaPipe Object Detector) | none |
| Precise cutout of the product | Meta Model API, mask composited in the browser | `sam-3.1` |
| Voice to text, in short chunks | Meta Model API | `muse-voice-transcribe-1.0` |
| "This costs 100", "20 percent off", "remove that one" | Meta Model API, tool calls only | `muse-spark-1.3` |
| Studio photo (background and shadow only) | Meta Model API (Phase 1) | `muse-image-1.0` |

The Cloudflare Worker stays light: it adds the API key, checks the spending caps and passes
responses through. Frame sampling, mask decoding and compositing happen on the phone. Raw videos go
from the phone straight to R2 through signed URLs and are deleted after 7 days.

## Design kit

`design-kit/` holds the build prompt for Muse (`MUSE_PROMPT.md`), the design system, tokens,
and screenshots of every screen. Start there to rebuild or extend the app.

## Run it locally

Requirements: Node 20.17+ (or 22.9+), a Meta Model API key from [dev.meta.ai](https://dev.meta.ai).

```bash
npm install
cp .dev.vars.example .dev.vars   # then put your MODEL_API_KEY in it
npm run dev
```

Open http://localhost:3000/capture (Next.js picks the next free port if 3000 is taken). The camera
needs HTTPS on any host other than localhost, so test on a phone through a deployed preview or a
tunnel.

Other commands: `npm run preview` (production build in the Workers runtime), `npm run deploy`,
`npm run cf-typegen` (after changing `wrangler.jsonc`).

## Configuration

| Name | Where | What |
|---|---|---|
| `MODEL_API_KEY` | secret | Meta Model API key. Server only. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | secret | Signs short-lived upload URLs for the raw videos. |
| `SESSION_CAP_USD`, `DAILY_CAP_USD` | `wrangler.jsonc` vars | Hard spending caps checked before each Meta API call. |

## License

[AGPL-3.0](LICENSE)
