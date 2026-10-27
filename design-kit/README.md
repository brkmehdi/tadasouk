# SmallStore design kit

Everything needed to rebuild SmallStore as it works today, or to keep building it, with Muse.

| File | What it is |
|---|---|
| `MUSE_PROMPT.md` | The build prompt: product, hard rules, stack, exact Meta API calls, every screen behavior with its numbers, research pipeline, agent tools and prompt, iPhone details, measured latencies, decision log, what is left, and the "done means" checklist. |
| `DESIGN_SYSTEM.md` | Brand, principles, tokens, capture screen layout, every component, motion, the French interface text, the receipt format. |
| `tokens/smallstore.css` | The app's real stylesheet (Tailwind CSS v4): tokens, `.ui-*` building blocks, motion, frame handles, iOS field guard. |
| `tokens/tokens.json` | The same values as data (colors, type, radii, shadows, sizes, motion). |
| `screens/01…08.png` | The eight screens on a 390×844 phone (@1.5x), taken from the working app. |
| `scenes/*.webp` | Two shop photos made with muse-image-1.0, used as a stand-in camera for tests and demos. |
| `assets/icon.svg` | App icon. |

## How to use it with Muse

1. Start a new session in an empty repository.
2. Paste the whole of `MUSE_PROMPT.md` as the first message, and attach `DESIGN_SYSTEM.md`,
   `tokens/smallstore.css`, `tokens/tokens.json` and the eight screenshots.
3. Ask Muse to build in this order, and to check each step against the screenshots before the
   next one: (1) project setup and Meta API routes with caps; (2) capture screen with
   detection, shutter, cutout on white and the tray; (3) voice and agent; (4) research per
   product and the product sheet; (5) hold-to-frame; (6) barcodes and the sale screen;
   (7) photo preview with score.
4. For phone tests, deploy to a workers.dev preview (the camera needs HTTPS). On a desktop,
   feed a `scenes/*.webp` photo into a canvas `captureStream()` and override
   `navigator.mediaDevices.getUserMedia` to return it, inside a 390×844 iframe.

The values and rules in these files are the ones the live app uses
(https://smallstore.smallstore-app.workers.dev/capture). If a screenshot and the text
disagree, the text wins. Two details changed after the screenshots were taken: the frame now
opens nearly full screen before it snaps onto the product (screen 04 shows it after the snap),
and the frame hint now appears only once the frame is visible (screen 03 still shows it during
the hold).
