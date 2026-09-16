# Asset packs — printing artwork you have the rights to

The frames in `src/js/frames/` are original art generated in code. An **asset
pack** is the other path: a folder of image files somebody supplied, plus a
manifest saying where the photo goes and where each piece of text sits. The
booth composites into those files — it does not redraw them.

That is how licensed work is actually produced. A licensor gives you the frame
artwork, the character art, the symbols, the fonts and a style guide; you place
photos and names into them and submit samples for approval. This pipeline is
built for that, and it works the same for a licensed character property, a
sports team, a school, a corporate client, or your own illustrator's work.

**This repo cannot verify that you hold a licence, and doesn't try.** It records
who the licensor is, prints the attribution line they require, and can stamp
every card as an approval sample. The rights are yours to hold and yours to
prove.

---

## Making a pack

```bash
node tools/new-pack.mjs my-licensed-set     # scaffold + SPEC.md for your artist
# ... drop the supplied art into packs/my-licensed-set/frames, symbols, characters
node tools/validate-pack.mjs packs/my-licensed-set
node tools/render-pack.mjs   packs/my-licensed-set --approval
```

Then add it to `assetPacks.load` in `config/booth.config.json` and it appears as
its own tab in the kiosk picker, marked with a ◆.

`packs/example-studio/` is a complete working pack built from original art. Read
it as the reference implementation, or copy it and swap the files.

---

## The manifest

`pack.json`. **Every coordinate is a fraction of the card, 0..1** — never pixels
— so one manifest renders correctly at a 360px picker thumbnail and a 750×1050
print master.

```jsonc
{
  "schema": 1,
  "id": "my-licensed-set",
  "name": "My Licensed Set",

  "licensor": {
    "name": "Acme Properties Inc.",         // who owns the artwork
    "agreement": "LIC-2026-0114",           // your agreement reference
    "contact": "licensing@acme.example"
  },
  "attribution": "™ & © {{year}} Acme Properties Inc. Used under licence.",
  "attributionPosition": { "x": 0.5, "y": 0.972, "size": 0.0155, "align": "center" },
  "approvalRequired": true,

  "defaultFont": "AcmeDisplay, system-ui, sans-serif",
  "fonts":   [{ "family": "AcmeDisplay", "file": "fonts/acme.woff2", "weight": 800 }],
  "symbols": { "fire": "symbols/fire.png", "water": "symbols/water.png" },

  "frames": [{
    "id": "classic-fire",
    "name": "Classic Fire",
    "art": "frames/classic-fire.png",       // transparent where the photo shows
    "aspect": [2.5, 3.5],
    "photoWindow": { "x": 0.088, "y": 0.150, "w": 0.824, "h": 0.404, "corner": 0.006 },
    "photoFocal":  { "x": 0.5, "y": 0.38 },
    "collectorNumber": "01",

    "symbolSlots": [
      { "id": "type", "symbol": "fire", "x": 0.905, "y": 0.113, "r": 0.036 }
    ],

    "text": [
      { "id": "name", "value": "{{name}}", "x": 0.105, "y": 0.128,
        "w": 0.6, "size": 0.052, "weight": 800, "color": "#2a2118" },
      { "id": "hp", "value": "{{hp}} HP", "x": 0.855, "y": 0.126,
        "size": 0.04, "weight": 900, "color": "#b0231f", "align": "right" },
      { "id": "flavor", "value": "{{headline}}", "x": 0.105, "y": 0.775,
        "w": 0.79, "size": 0.026, "wrap": true, "lineHeight": 0.034, "maxLines": 2 }
    ]
  }]
}
```

### Tokens available in any `value`

`{{name}}` `{{age}}` `{{hp}}` `{{headline}}` `{{thanks}}` `{{companion}}`
`{{serial}}` `{{collectorNumber}}` `{{rarity}}` `{{booth}}` `{{date}}` `{{year}}`

Anything under a frame's `values` object is available too, so a pack can carry
its own fixed strings.

### Text zone options

| key | meaning |
|---|---|
| `x`, `y` | position, fractions of card width/height. `y` is the text baseline |
| `w` | max width — the text shrinks to fit rather than overflowing |
| `size` | fraction of card **width** (so 0.05 on a 750px card = 37.5px) |
| `weight`, `color`, `align`, `font` | as you'd expect |
| `wrap`, `lineHeight`, `maxLines` | word-wrapped paragraph instead of one line |
| `shadow` | `{ color, blur, dy }` — for text sitting over artwork |
| `overPhoto` | acknowledge that this zone deliberately sits over the photo |

---

## What to ask your licensor for

There is a ready-to-send request in **[`ASSET-REQUEST.md`](ASSET-REQUEST.md)** —
copy it into an email. It asks for the delivery in the shape this pipeline
consumes, which saves a round trip, and it covers the rights questions that
matter for a photo booth specifically.


Producing the files is the long pole. `tools/new-pack.mjs` writes a `SPEC.md`
into every new pack — hand that to whoever is making the art. The short version:

- **Frame art**: PNG with alpha, at least 750×1050 (300dpi card), ideally 1500×2100.
  2.5:3.5 aspect. **The photo window must be fully transparent.**
- **No live text baked into the artwork.** Names, HP and numbers are drawn by the
  booth so they can be personalised — the art supplies the plates they sit on.
  This is the single most common thing to get wrong in the first delivery.
- **Symbols**: 256×256 PNG with alpha.
- **Fonts**: only faces your licence covers for embedding.
- **The exact attribution line**, character for character.
- **The approval process**: who signs off, on what, and how long it takes.

Also get, in writing: which properties and marks are covered, whether the use is
retail or events-only, the term, the territory, and whether photographs of
customers may be composited with the artwork at all — that last one is
specifically restricted in some agreements and is exactly what this booth does.

---

## Approval mode

Set `assetPacks.approvalMode: true` in `config/booth.config.json`. Every card
comes out diagonally watermarked **SAMPLE — FOR APPROVAL** with a red footer
naming the licensor and the date, so a review print can never be mistaken for a
sale print.

The operator panel shows a red **APPROVAL MODE** row whenever it's on. Turn it
off before you sell anything.

---

## Validation

`node tools/validate-pack.mjs packs/<id>` inspects the actual pixels, not just
the JSON. It catches the four mistakes that only show up on paper:

| Check | Why |
|---|---|
| Photo window transparency | Art exported without alpha prints an opaque rectangle over the customer's face |
| Resolution vs 300dpi | Upscaled art looks fine on the touchscreen and soft in the hand |
| Aspect match | Mismatched art gets stretched |
| Text zones in bounds | A zone at `x: 1.4` silently renders off the card |

It also flags files present in the folder but unreferenced by the manifest — the
usual sign of a half-finished asset swap. Exits non-zero on error, so you can
put it in CI or a pre-event checklist.

---

## Where packs sit in the code

```
src/js/frames/assetpack.mjs   manifest schema, validator, loader, compositor
src/js/frames/templates.mjs   the `assetPack` template — a thin adapter
tools/new-pack.mjs            scaffold a pack + SPEC.md
tools/validate-pack.mjs       manifest + pixel checks
tools/render-pack.mjs         render samples, optionally approval-stamped
```

Packs print through exactly the same path as the drawn frames: same
`renderCard()`, same 300dpi master, same CUPS PDF on the Pi. A pack that fails to
load is logged and skipped — the drawn frames keep working, because a bad pack
should never take a booth down mid-event.
