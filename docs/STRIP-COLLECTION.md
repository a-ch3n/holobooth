# HoloBooth Strip Collection

Twelve photo-strip designs, each sold in two formats:

| | **Signature Strip** | **Jumbo Strip** |
|---|---|---|
| Size | 2 × 6 in | 4 × 6 in |
| Master | 600 × 1800 px @ 300 dpi | 1200 × 1800 px @ 300 dpi |
| Photos | 3 or 4 | 3 or 4 (4 is the maximum for every design) |
| On the DS40 | two-up on 6×4 media, auto-cut (`printing.stripSheet`) | one per 6×4 sheet, turned, no cut (`printing.jumboSheet`) |
| Picker tab | Signature Strips | Jumbo Strips |
| Products | the existing strip products | `jumbo_strip`, `two_jumbo_strips` |

The classic "Photo Strips" tab (10 colour themes + custom colour) is unchanged.

Proofs: `node tools/render-strips.mjs` → `out/strips/` (print masters, contact
sheets, colourway sheets, photographed-print mockups). Add `--web` for
screen-size previews of every colourway, `--all` for a 300 dpi master of every
colourway, `--only <style>` to iterate on one design.

---

## The twelve concepts

| | Name | Concept | Colourways (lead first) | 2×6 photos | Jumbo photos / lead |
|---|---|---|---|---|---|
| A | **Atelier** | Minimalist luxury: gallery margins, double hairline, Didone italic name | Ivory, Noir, Sand, Pearl | 4 | 3 · Noir |
| B | **Reel** | Retro film: sprockets, edge print, glowing date stamp, film-canister label | Gold Stock, Cine Amber, Slide Blue, Pan B&W | 4 | 3 · Gold Stock |
| C | **Starlight 2K** | Y2K: chrome type, candy gradients, sparkles, sticker slaps | Bubblegum, Ice, Lime Soda, Cyber Night | 4 | 4 · Cyber Night |
| D | **Seoul Cut** | Korean four-cut booth: clean white, pastel doodles, 오늘의 우리 | Milk, Peach, Sky, Lilac, Matcha | 4 | 4 · Milk |
| E | **Cover Story** | Editorial magazine: the name is the masthead, cover lines, asymmetry | Mono, Press Red, Ink, Nude | 3 | 4 · Mono |
| F | **Instant** | Instant-film frames, handwritten captions, tape | Kraft, Linen, Blush, Sage, Night | 3 | 4 · Linen |
| G | **Chrome Drive** | Futuristic: brushed metal, bevelled chrome, holographic band, HUD brackets | Liquid Silver, Holo Black, Ice, Gold Leaf | 4 | 4 · Holo Black |
| H | **Scrapbook** | Torn paper, tape, stickers, handwritten notes | Kraft, Gingham, Notebook | 3 | 4 · Gingham |
| I | **Date Night** | Couples: arched windows, script names, quiet hearts | Rouge, Rosé, Midnight, Blanc | 3 | 3 · Midnight |
| J | **Party Pop** | Birthday: confetti, candy letters, the age in a balloon | Confetti, Sprinkle, Party Night, Sunshine | 3 | 4 · Confetti |
| K | **Keepsake** | Wedding / event: monogram crest or logo, botanicals, names in script | Botanical, Classic, Blush, Champagne, Navy | 3 | 3 · Botanical |
| L | **Street Issue** | Streetwear: heavy type, spray mist + drips, name-tag slap | Concrete, Blackout, Hazard, Acid | 4 | 3 · Concrete |

That's 12 concepts, 50 colourways, 2 formats = **100 frames**, each with its
own id: `sd-<style>-<palette>` (2×6) and `jb-<style>-<palette>` (4×6). The
picker shows each concept once (its lead colourway); the rest are colour chips
on **Decorate → Frame**.

---

## What goes on a strip

Every design draws the same pieces of text, from the same places:

| Field | Comes from | Notes |
|---|---|---|
| **Name** | what the customer types (Name tab) | Never falls back to the design's own name |
| **Event title** | operator panel → Event text (`strips.event.title`) | e.g. "Olivia & James" — Keepsake builds its monogram from the two initials |
| **Date** | `strips.event.date`, else the day it prints | each design formats it its own way (`11.05.2026`, `'26 11 05`, `November 5, 2026`…) |
| **Message** | `strips.event.message` | shown by Scrapbook and Keepsake, and on the Jumbo Atelier and Date Night |
| **Logo** | `strips.event.logo` — a PNG under `src/` | shown by Atelier (Jumbo) and Keepsake, where it replaces the crest |
| **Age** | the Age field | Party Pop puts it in the balloon |

The headline is *name → event title → the design's own default* ("Besties",
"Date Night", "No Sleep Club"…), so a strip with nothing typed still looks
finished.

---

## Design rules

**Photos are the product.** Nothing is drawn over a photo except, where the
concept depends on it, one small corner element: Reel's date stamp, a corner of
tape, a sticker slap on a frame's outer corner. Never across a face.

**Booth-proportioned windows.** The booth cameras capture 3:2 / 16:9 landscape.
`arrange()` keeps every window in a range that crops safely:

| Layout | Used for | Window aspect |
|---|---|---|
| stack | 2×6 strips; Jumbo with 3 photos | 1.2 – 1.75 (2×6), 1.3 – 1.95 (Jumbo) |
| grid 2×2 | Jumbo with 4 photos | 0.95 – 1.5 (Seoul Cut allows 0.8 for its portrait four-cut look) |

No design takes more than 4 photos (`MAX_SHOTS` in `engine.mjs`), so a session
never needs more than 4 shots. A style can carve its own layout (Cover Story's
cover photo with three below, Instant's tossed frames) and still has to report every window through `env.track()`,
which is how stickers and the smoke test know where the photos are.

**Type that survives paper.** Designs are written in inches and points
(`u(0.12)`, `pt(9)`), never pixels. `text()` will not shrink below **6 pt**;
past that it truncates with an ellipsis. Text stays ≥ 0.1 in inside the trim.

**Fonts.** Every face is a stack: the macOS face the proofs were designed in,
then the closest face Windows ships with, then a generic. On the Windows kiosk
expect Constantia/Georgia for the Didones, Century Gothic/Bahnschrift for
Futura, Segoe Script for Snell Roundhand, Segoe Print/Ink Free for the hands,
Malgun Gothic for Korean. Hearts, stars, sparkles, arrows, leaves and the
seven-segment date stamp are drawn as paths so they never depend on a font.

**HoloBooth branding.** Every design carries the HoloBooth spark (a four-point
twinkle) and/or the tracked wordmark exactly once, small, in that design's own
ink and typeface: a maker's mark, not an ad. Seoul Cut signs it "photo by
✦ HOLOBOOTH" at the top, the way Seoul booths do; Reel prints it as film edge
code; Cover Story makes it the "HoloBooth Edition" issue line.

**No borrowed marks.** The concepts are *inspired by* film stock, instant film,
magazines and streetwear, never imitations of a brand: no Kodak, Fujifilm,
Polaroid, Instax, Vogue or Supreme names, logos or trade dress. Reel's label is
yellow/red because that's what film boxes look like, but it says HOLOBOOTH 400.

---

## Extending it

**Add a colourway:** one line in the style's `palettes` (`src/js/frames/strips/styles-*.mjs`).
It becomes a frame and a colour chip automatically.

**Add a concept:** write a style object (`{ id, letter, name, blurb,
defaultHeadline, palettes, draw(env) }`), add it to `STYLE_ORDER` and
`COLLECTION` in `catalog.mjs`. `draw(env)` gets:

```
env.ctx, W, H        canvas and size
env.u(in), env.pt(pt) physical units
env.jumbo, env.n     format and shot count
env.pal              the chosen palette
env.T                text: headline, name, event, message, date.{dots,long,…}, age, logo
env.arrange(region, gap, opts)  booth-proportioned slots for this format and n
env.img(i), env.track(slot), env.tone, env.focal, env.seed
```

and draws with the kit (`kit.mjs`): `text`, `wrap`, `vtext`, `photo`, `paper`,
`filmGrain`, `halftone`, `brushedMetal`, `tape`, `tornRect`, `sprig`, `heart`,
`star`, `sparkle`, `segDigits`, `doodleArrow`, `brand`, `logo`.

**Add a format:** an entry in `FORMATS` (`engine.mjs`), a size in `SIZES`
(`render.mjs`), a sheet in `printing` and a product with `prints.<format>`.

Then run `npm test`: it renders every concept in both formats with 3 and 4
photos and blank, normal and overlong text, and fails on missing, overlapping,
off-sheet or badly proportioned photo windows.

---

## Before the first event

- **Print one Jumbo on the DS40.** `printing.jumboSheet` mirrors the confirmed
  strip sheet (rotated onto dnp6x4, `orientation-requested=6`) without the
  cutter, but it hasn't been through the real printer yet. If it comes out
  upside down, change 6 to 5.
- **Set the Jumbo prices.** `jumbo_strip` ($10) and `two_jumbo_strips` ($16)
  are placeholders. Run `npm run stripe:sync` after changing them.
- **Check the fonts on the kiosk.** Render a few designs on the Windows PC and
  compare with the proofs. If a face falls back badly, the fix is to bundle an
  open-licence (OFL) font under `src/fonts/` and put it first in the stack.
