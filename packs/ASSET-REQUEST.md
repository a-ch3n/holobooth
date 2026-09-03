# Asset request — send this to your licensing contact

Copy the section below into an email. It asks for the delivery in exactly the
shape `packs/` consumes, which saves a round trip: the most common first
delivery is flattened JPEGs with the card text baked in, and those cannot be
personalised.

Fill in the bracketed parts.

---

**Subject:** Asset delivery + approval process for [agreement ref]

Hi [name],

We're building a photo booth that prints personalised trading cards under
[agreement ref]. Guests have their photo taken, it's composited into a card
frame, and the card prints on a dye-sub printer at 300 dpi, 2.5 × 3.5 in.

To produce these correctly I need the following.

**1. Frame artwork**

- PNG with an alpha channel, **≥ 750 × 1050 px** (300 dpi at card size);
  1500 × 2100 preferred so we have headroom for an oversized photo-prop board.
- **The photo window knocked out — fully transparent.** The guest's photograph
  goes behind the frame. A flattened export prints an opaque block over their face.
- **No live text baked into the artwork.** Names, ages and numbers are drawn at
  print time so they can be personalised per guest. Please supply the empty
  nameplates, stat boxes and text panels as part of the art, with the type
  specification (font, size, colour, alignment) separately.
- One file per colourway/variant we're licensed to use.

**2. Supporting art**

- Symbols/icons: 256 × 256 PNG with alpha, one per file.
- Character art, if in scope: transparent PNG, ~1000 px on the long edge.
- Fonts: the actual font files, **and confirmation that our licence covers
  embedding them** in this application. If it doesn't, tell me the approved
  substitute.

**3. The attribution line**

The exact notice we must print, character for character, including the symbol
and year format. It prints on every card.

**4. Approval process**

- Who approves designs, and what they need to see (we can supply watermarked
  sample prints and PDFs).
- Expected turnaround, and whether approval is per design or per campaign.
- Whether approval is needed again if only the guest's name and photo change.

**5. Three scope confirmations, in writing**

- **Compositing photographs of members of the public with the licensed
  artwork** — this is the core of the product and is restricted in some
  agreements, so I want it stated explicitly rather than assumed.
- Whether the permitted use is events-only or includes retail sale of the
  printed cards.
- Term, territory, and whether guests may post the resulting images to social
  media.

Happy to send sample output at any point — everything we produce before sign-off
is watermarked "SAMPLE — FOR APPROVAL" and cannot be sold.

Thanks,
[you]

---

## When the delivery arrives

```bash
npm run pack:new <pack-id>            # scaffold
# copy their files into packs/<pack-id>/frames, symbols, characters, fonts
# fill in licensor, attribution and photoWindow in pack.json
npm run pack:check packs/<pack-id>    # verifies transparency, resolution, bounds
npm run pack:render packs/<pack-id> --approval   # watermarked samples to submit
```

Put the signed agreement in `packs/<pack-id>/LICENSE.txt`. Set
`assetPacks.approvalMode: false` only once you have written sign-off.
