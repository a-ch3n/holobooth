# HoloBooth — Pocket Creatures

A photobooth that prints **collectible creature cards**.

The customer picks a Creature, strikes a pose, pays by tap, and walks away with a
printed trading card: their photo in the art window, a type-coloured frame, HP
and attacks, a weakness/resistance footer, a collector number, and a rarity tier
with a foil treatment they can see from across the room.

The camera is a real camera — it comes in over HDMI through a capture card, so
the booth sees a normal webcam and you get a Fujifilm/Sony/Canon image instead
of a laptop cam.

---

Runs on a **desktop** (Electron) or a **Raspberry Pi** (Chromium kiosk + a small
Node service). Same UI, same card engine, same print master — see
[`pi/README-pi.md`](pi/README-pi.md) for the Pi build.

## Try it in 60 seconds

```bash
npm install
npm run dev          # Electron, windowed, DevTools open, mock payments
npm run web          # or: plain browser, no Electron needed
npm run doctor       # if something won't start, this says which of the four things it is
```

No camera or printer? The picker, rarity rolls and card rendering all still
work. Press `d` before paying to simulate a decline, `Esc` to abandon a session.

```bash
npm run render                                # out/frames/*.png at screen size
node tools/render-all.mjs --print --dpi 300   # 750x1050 print masters
node tools/smoke-test.mjs                     # odds, set integrity, rendering, GIF
node tools/build-gallery.mjs                  # self-contained HTML set gallery
```

---

## The set

**Pocket Creatures — Base Set** (`PP-BASE`): 23 cards in the set, plus 3 secret rares
numbered past the end of it and 2 limited promos. 28 cards total.

| Class | Count | What it is |
|---|---|---|
| Basics | 14 | One Creature per energy type — where a collection starts |
| MAX Cards | 5 | Silver two-tone frame, ~1.9× HP, ~1.6× damage. The chase card. |
| Full Art | 4 | Dark metallic frame, text floating below the photo window |
| Secret Rare | 3 | Full art + rainbow foil, numbered `024/023` and up |
| Limited Promos | 2 | Hand-drawn guest characters, availability windows, mint caps |
| Party Cards | 6 | **Personalised** — name, age and a chosen buddy go on the card |
| Cutie Club | 6 | **Personalised**, pastel — scalloped sticker edge, heart HP tag, mascot peeking out |
| Photo Strips | 6 | The classic four-frame 2×6 strip, themed, named and stickerable |

Fourteen energy types — Ember, Wave, Leaf, Volt, Frost, Stone, Gale, Shade,
Radiant, Toxin, Steel, Psy, Wyrm, Plain — each with a colour ramp, a
path-drawn glyph and a place in the weakness chart. **The glyphs are paths, not
font characters:** a card that prints a tofu box where the fire symbol should be
is a card you refund.

---

## How it fits together

```
src/js/app.js         the state machine: attract → pick → pay → shoot → reveal
src/js/bridge.js      one window.booth API, three backends (see below)
src/js/camera.js      HDMI capture card detection, capture, burst
src/js/payments.js    stripe-terminal | stripe-qr | mock, one interface
src/js/gif.js         GIF89a encoder (median-cut + LZW), no dependencies
src/js/frames/
  energy.mjs          the 14 types: colours, glyphs, pips, weakness chart
  packs.mjs           THE SET — a creature table that expands into every variant
  templates.mjs       creature · creatureMax · creatureFullArt · strip
  rarity.mjs          weighted rolls, foil treatments, serials, holo art box
  assetpack.mjs       licensed-artwork packs: schema, validator, compositor
  render.mjs          the single entry point everything calls
  draw.mjs            canvas primitives (bevels, holo sweeps, grain, measuring)

electron/main.js      DESKTOP: kiosk window, silent printing, ledgers, IPC
electron/preload.js   DESKTOP: the only bridge to node — named channels only
pi/kiosk-server.mjs   PI: the same jobs over JSON-RPC, no Electron
pi/print.mjs          PI: exact-size printing via CUPS
pi/gpio-button.py     PI: arcade buttons → the same flow as a screen tap

server/index.js       Stripe secret key + QR downloads + season dex (both platforms)
config/booth.config.json   every number you'd want to change on site
```

### One UI, three platforms

`src/js/bridge.js` picks its backend at boot, so **no application code differs
between platforms**:

| Running on | `window.booth` is backed by |
|---|---|
| Electron desktop | the preload script's IPC channels |
| Raspberry Pi | JSON-RPC to `pi/kiosk-server.mjs` on localhost |
| Plain browser (`npm run web`) | an in-memory stub — no printing, laptop webcam |

That's why the Pi port needed no changes to the state machine, the camera layer
or the card engine. Only this one file knows where the calls actually go.

Two structural decisions worth knowing:

**The picker thumbnail, the on-screen reveal and the print master all go through
one `renderCard()`.** There is no separate preview renderer to drift out of
sync, so a card cannot look one way on the touchscreen and another in the tray.

**The set is generated, not hand-authored.** `packs.mjs` holds a creature table;
a builder derives each card's palette from its energy type, assigns collector
numbers in set order, and emits every variant the card qualifies for. That's why
a MAX card automatically has 1.9× the HP of its base card and why secret rares
automatically number above the set size.

---

## Which styles appear

`picker.show` in `booth.config.json` lists the style groups the picker offers,
in order:

```json
"picker": { "show": ["strips", "promo", "basics", "max", "fullart", "secret"] }
```

Hiding a group never deletes it — Party Cards, Cutie Club and any asset packs
stay in the catalogue and come back by adding their id (`party`, `cutie`,
`assetpack:<id>`). An empty or missing list shows everything.

## Photo strips

Strips are a style you pick, not a by-product of buying a card: 2×6, four
frames, six themes, and they take the same name and stickers as the cards. A
sticker can straddle two frames the way it does on a real strip, because the
whole photo column is one window.

Because a strip is 2:6 and a card is 2.5:3.5, **nothing may assume the card
aspect** — `frameAspect()` and `frameBox()` in `packs.mjs` are the only place
that decides, and the picker tiles, decorate preview, swatch row, reveal
carousel and print master all size themselves from it.

## The session flow

```
attract → pick a style → [personalise] → pay → shoot → DECORATE → reveal → print
```

`DECORATE` is where the session actually becomes theirs, and it has three tabs:

**Photo** — all four shots from the session, tap the one that goes on the card.
Previously the booth just used the first frame, which is rarely the best one.

**Name** — an on-screen keyboard to name the card. Works on every style, not
just party cards; leave it blank to keep the style's own name.

**Stickers** — 26 originals (12 mascots + 14 decorations), tap to place, then
**drag to move, pinch to scale, twist to rotate** directly on the card preview.
Two-finger gestures on the touchscreen, mouse-wheel scaling on a desktop. A tray
shows what's placed; tap one to take it off.

Positions are stored as fractions of the photo window, never pixels — which is
what lets someone arrange a sticker on a 380px preview and have it land in the
same spot on the 750×1050 print master and the 3600px prop board.

**Frame** — swap the frame with a live preview, or take the **mystery pull**: a
slot-machine carousel that slides through the pack, decelerates on a strong
ease-out, and settles on the frame you got under a spotlight. It's the moment
people film.

---

## Licensed artwork — asset packs

Everything above is original art drawn in code. If you hold rights to somebody
else's property, you don't redraw their frame — you composite into the files they
give you. That's what `packs/` is for:

```bash
node tools/new-pack.mjs my-licensed-set      # scaffold + a SPEC.md for your artist
node tools/validate-pack.mjs packs/my-licensed-set
node tools/render-pack.mjs   packs/my-licensed-set --approval
```

A pack is a folder of supplied images plus a manifest saying where the photo and
each piece of text sit, in fractions of the card. Add it to `assetPacks.load` and
it shows up as its own picker tab, prints through the same 300dpi path, and
carries the attribution line your licence requires on every card.

`approvalMode: true` stamps every card **SAMPLE — FOR APPROVAL** for the
licensor review round, and the operator panel shows a red warning row while it's
on.

The validator inspects pixels, not just JSON — photo-window transparency,
resolution against the 300dpi master, aspect match, text zones in bounds. Those
are the four mistakes that only show up on paper.

**Full guide: [`packs/README.md`](packs/README.md)** — including what to ask a
licensor for, and the terms worth getting in writing.

---

## Party cards

The birthday format, and probably the thing that sells at events. The customer
picks a colourway, then types a name and an age on the touchscreen and picks one
of twelve mascots. Everything else is derived, because asking a parent at a
party to fill in eight fields is how you lose the queue:

| They enter | The card gets |
|---|---|
| `Audrey` | the name, and every attack that mentions her by name |
| `6` | `AGE 6`, the headline "Audrey is 6 years old!", **120 HP** (60 + age×10), and "Thank you for celebrating Audrey's 6th birthday!" |
| a buddy | the mascot in the corner badge, and "best friends with Twinkle" |

Override any of it by passing `headline`, `thanks`, `ribbon` or `hp` in the
personalization object — `buildPersonal()` in `render.mjs` only fills what you
didn't supply.

### Cutie Club

The soft/cute style, and its own visual world rather than a recolour of the
creature cards: pastel stock with a scalloped sticker edge, a big rounded photo
window in a thick white outline, a heart-shaped HP tag, a ribbon nameplate with
a bow, three stat chips, and one of the twelve mascots peeking out from behind
the photo.

Six colourways — Strawberry Milk, Soda Pop, Matcha Cloud, Butter Cake, Ube
Dream, Cinnamon Bun. They take the same name/age personalisation as party
cards, so the style works both as a plain keepsake and as a birthday card.

### The mascots

Twelve original companions in `src/js/frames/companions.mjs`, each tied to an
energy type and **drawn from parameters** — body shape, ears, face, accessory —
so the booth ships with twelve distinct characters and no art assets at all.

When you commission real art, drop a transparent PNG at
`src/assets/companions/<id>.png` and it replaces the drawn version with no code
change. The procedural mascots are a working placeholder, not the ship art.

### The photo-prop board

The oversized card people hold up in front of them — the actual photo op at a
party, where the printed card is the keepsake.

```bash
node tools/make-prop-board.mjs --frame party-bubblegum --name Audrey --age 6 --buddy twinkle
```

Exports a 24×33.6″ print-ready PDF with the art window marked for cutting and
crop marks at the corners. Trims from a standard 24×36″ sheet of 5mm foam board
with 2.4″ of waste. The cut area is left unprinted, and the board carries the
same name, age and mascot as the cards from that event.

---

## Adding a Creature

Append to `CREATURES` in `src/js/frames/packs.mjs`:

```js
{
  id: 'cocoabun', name: 'Cocoabun', type: 'plain', hp: 70, retreat: 1,
  flavor: 'Warms up the booth by three degrees just by being in it.',
  attacks: [
    { cost: ['plain'], name: 'Cozy Up', dmg: 20, text: 'Everyone leans in.' },
    { cost: ['plain', 'plain'], name: 'Marshmallow', dmg: 50, text: 'Heal 20 from every Creature in frame.' },
  ],
}
```

Colours, the weakness footer, the collector number and the picker tile all come
from `type`. To give it chase variants, add its key to `MAX_CARDS`, `FULL_ART`
or `RAINBOW` at the top of the same file.

**A limited promo** goes in `PROMOS` and adds:

```js
availability: { start: '2026-10-01', end: '2026-11-01', mintLimit: 666 },
rarityFloor: 'ultra',
character: { file: 'characters/hallowisp.png', anchor: 'bottom-left', scale: 0.44 },
```

Out-of-window promos vanish from the picker automatically, the attract screen
grows a live countdown, and mint 667 comes back flagged `soldOut`. Drop the
character art in `src/assets/characters/` as a transparent PNG, ~1000px on the
long edge.

---

## Rarity and foil

| Tier | Base odds | Foil treatment |
|---|---|---|
| Common | ~58% | none |
| Uncommon | ~24% | satin sheen |
| Rare | ~12% | holo sweep + sparkles |
| Ultra Rare | ~5% | rainbow prismatic, cross-hatched |
| Secret Rare | ~1% | gold overlay, heavy sparkle |

Card classes set a floor: a MAX card never rolls below Ultra, a rainbow secret
never below Secret. Products carry a `rarityBoost`, and the booster pack carries
`guaranteeAtLeast: "rare"` — `rollPack()` upgrades a card if three rolls all came
up short. Verified over 5,000 simulated packs in the smoke test.

### Card stock

`cards.stock` in `booth.config.json` sets the border treatment for the drawn
creature frames:

| Value | Look |
|---|---|
| `gold` | Metallic foil — gradient plus brushed diffraction lines (default) |
| `classic` | Flat saturated yellow board. Bright, toy-shelf, no metallic texture — the classic sports/game card look |
| `type` | The card's own energy colour as the border |
| `silver` | Used automatically by MAX cards |

MAX cards always use `silver` and full arts have no card-stock border of their
own, so this setting affects Basics cards.

**On real foil:** what's drawn here is a *printed simulation* — it reads
correctly at arm's length and photographs well, but it doesn't move in the
light. The cheap route to cards that actually shimmer is running the print
through a laminator with holographic overlay film (~$0.06/card); the expensive
route is pre-printed holographic stock, which needs a printer that can feed it.
The simulation and the film stack fine together.

---

## Hardware

| Part | What to get | Notes |
|---|---|---|
| Camera | Any body with **clean HDMI out** | A Fujifilm X-E5 works well — set HDMI output to clean/no-info so overlays don't print |
| Capture card | Elgato Cam Link 4K, or a generic UVC HDMI dongle | This is what makes the camera look like a webcam. Generic dongles are often 1080p30 MJPEG — fine for stills |
| Lens | 16–23mm equivalent | Two people at four feet in a booth |
| Printer | DNP DS620A / Citizen CX-02 dye-sub, or Canon SELPHY on a budget | Dye-sub prints are dry and handleable instantly, which matters when there's a line |
| Payment | Stripe **WisePOS E**, or Tap to Pay on a spare iPhone | Card-present rates beat online rates |
| Display | 1080×1920 portrait touchscreen | CSS is built for portrait but reflows |
| Lighting | Constant LED panel, not flash | Flash and rolling-shutter HDMI capture do not get along |

### The HDMI camera path, specifically

Camera HDMI → capture card → USB. The card enumerates as a UVC webcam, so
`getUserMedia` sees it and there's no vendor SDK to fight. Then:

1. Put a distinctive part of the device's name in `camera.preferredLabels`
   (`"Cam Link"`, `"USB Video"`, whatever your dongle calls itself). The
   operator panel lists every device it sees with its exact label.
2. Keep `excludeLabels` populated — otherwise on a laptop the built-in webcam is
   device #0 and the booth films the operator.
3. Turn off the camera's auto-power-off. A camera that sleeps mid-event drops
   the HDMI signal; `camera.js` catches the dead track and surfaces it, but it
   can't wake your camera for you.
4. `warmupMs` exists because capture cards output black for a beat while they
   lock onto the signal. Don't set it to 0.

Cameras with a **micro** HDMI port need a locking or right-angle cable. This is
the single most common failure at an event: someone brushes the cable, the
signal drops, and the next customer gets a black card.

---

## Payments

Three providers behind one interface, chosen by `payments.provider`:

- **`mock`** — approves after a beat. Develop against this.
- **`stripe-terminal`** — the real thing. The server creates a PaymentIntent with
  `capture_method: 'manual'`, drives the reader, and **captures only after the
  print job is accepted.** A jammed printer becomes a void, not a chargeback.
- **`stripe-qr`** — customer pays on their phone from an on-screen QR. No
  hardware, slower line.

The secret key lives only in `server/index.js`:

```bash
STRIPE_SECRET_KEY=sk_test_... npm run server
```

Set `payments.stripe.locationId`, register the reader in the Stripe dashboard,
and the app finds it on boot. Leave `stripe.simulated: true` to test the whole
flow against Stripe's simulated reader before hardware arrives.

---

## AI names

The "Surprise me" button next to the name field (personalize screen, and the
decorate screen's Name tab) asks `server/index.js` for a real AI-generated
character name, via **Google's Gemini API** — chosen because its free tier
needs no credit card and costs nothing to run at an event. The kiosk never
holds the key — same reasoning as Stripe:

1. Grab a free key from [Google AI Studio](https://aistudio.google.com/apikey).
2. Run the server with it set:

```bash
GEMINI_API_KEY=AIza... npm run server
```

Without a key configured (or if the request errors, times out, or the server
isn't running at all), the button silently falls back to a local, offline
word-list generator instead — the feature never blocks the flow, it just gets
less varied. Set `ai.enabled: false` in `booth.config.json` to skip the AI
call entirely and always use the offline generator. `ai.timeoutMs` (default
6000) controls how long the kiosk waits before giving up and falling back.
`GEMINI_MODEL` (default `gemini-3.5-flash`) picks the model — check
[the current model list](https://ai.google.dev/gemini-api/docs/pricing) if
the default one is ever retired.

---

## Printing

Dye-subs are unforgiving about page geometry — if the page size doesn't match the
media exactly, the driver silently scales and your 2.5×3.5″ card comes out at
2.42×3.39″ and no longer fits a card sleeve. Both platforms solve it, differently:

- **Desktop:** `electron/main.js` builds a page whose `@page size` matches the
  media in inches with `margin: 0`, and passes the size to Electron in microns.
- **Pi:** `pi/print.mjs` wraps the browser's JPEG in a one-page PDF whose
  MediaBox is exactly 180×252 pt and prints it with `-o print-scaling=none`.
  A PNG carries no physical size so `lp` has to guess; a PDF MediaBox is
  unambiguous. No ImageMagick, no Ghostscript — PDF carries a JPEG bitstream
  verbatim via `/DCTDecode`.

Don't "fix" either one by letting the driver fit-to-page.

Most dye-subs only load 4×6 media. `printing.sheet.enabled` gangs card prints
onto a 4×6 with cut marks so you trim after — cheaper per card and much faster
than single-card media.

---

## Data

Two append-only JSONL ledgers under Electron's userData directory:

- `cards.jsonl` — every card ever minted. Source of truth for mint numbers, so
  the 412th Blazepup really is `#0412`.
- `sales.jsonl` — every sale, with payment id, brand and last4.

Append-only on purpose: it survives a power cut mid-event better than a database
you forgot to checkpoint, and you can `cat` it into a spreadsheet at the end of
the night. Back it up between events — it's the season's history.

---

## Legal note, briefly

These are original creatures, original type names, original frame art. What the
design borrows is the *visual grammar* of creature cards — HP in the corner,
energy costs beside attacks, a weakness/resistance footer, a collector number,
secret rares numbered past the end of the set. That grammar is genre language,
the same way a sonnet has fourteen lines.

What belongs to somebody else is their names, their logos, their creatures and
their frame artwork, and none of it is here. Keep it that way — a booth that
prints knock-offs is a booth with a shelf life, and this one is otherwise
entirely yours.

For the limited promos, commission original characters from an illustrator and
get the commercial rights in writing. A named guest artist per season is good
marketing anyway.

---

## What's stubbed

Honest list of what needs real work before an event:

- **Collector dex identity.** `collection.identifyBy` is set to `phone` but the
  kiosk never asks for one — cards record `collectorId: null`. The server
  endpoint (`GET /dex?id=`) works; the phone-entry screen doesn't exist.
- **Sheet ganging.** `printing.sheet` is read from config but `printImage()`
  still prints one card per page.
- **Fonts.** The card faces fall back to system fonts until you drop real files
  into `src/assets/fonts/` and add `@font-face` rules. The layouts hold either
  way, but a rounded display face is a big part of the genre's feel.
- **Promo character art.** `PROMOS` points at PNGs that aren't in the repo — the
  app renders a placeholder blob until you add them.
- **Custom attack text.** Party cards use two fixed attacks with the name
  substituted in. Letting the customer write their own would be a nice upsell
  and needs only a text field — the renderer already accepts it.
- **Retake** re-shoots the whole sequence rather than a single frame.
- **Receipts** — `payments.receipt` flags exist, nothing is wired.
- **Pi coin acceptor.** The GPIO watcher reports `coin` pulses and the bridge
  delivers them, but nothing counts credits against a price yet.
# holobooth
# holobooth
