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
src/js/payments.js    stripe-smart-reader | stripe-terminal | stripe-qr | mock, one interface
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
companion-app/        phone app that pairs with a Stripe M2 reader over Bluetooth
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
attract → pick a style → [personalise] → pay → [angle] → shoot → [filter] → DECORATE → reveal → print
```

`[angle]` and `[filter]` are both optional and skipped automatically unless
configured: `[angle]` only appears with 2+ entries in `camera.angles.list`,
`[filter]` only with `filters.enabled` and a real `filters.list` in
`config/booth.config.json`. `[filter]` runs on the actual photo just taken,
not a live camera feed — tap through the looks (Vintage Film, a punchier
point-and-shoot look, a neutral "Professional" look, "Original" to go back
to unfiltered, by default) and hit Next once you're happy. Nothing is baked
in until then: the raw shots are kept untouched the whole session, so picking
a filter is never a one-way trip. Whatever's chosen is what actually prints
and gets delivered — not a screen-only effect.

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
| Payment | Stripe **M2** + a phone running the companion app (`companion-app/`), or Tap to Pay on a spare iPhone | Card-present rates beat online rates. The M2 is Bluetooth-only — see the companion app's README for why a phone is in the loop |
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

**Two cameras through OBS (`camera.obsSplit`, on by default).** Opening
two capture cards at once can make Windows cut off the first one, and OBS
Virtual Camera only sends one picture. So OBS holds both cameras and puts
them **side by side in one scene**. HoloBooth opens OBS Virtual Camera once
and cuts it in two: each angle tile gets a live preview, and either can be
picked and shot at full 1920×1080.

1. **OBS → Settings → Video:** Base (Canvas) and Output (Scaled)
   resolution both **3840x1080**, FPS **30**.
2. Make a new scene, e.g. **Booth**. Add both cameras to it with
   **Sources → + → Video Capture Device → Add Existing**:
   - **M50 on the left half:** right-click → Transform → Edit Transform,
     Position **0, 0**, Size **1920 × 1080**.
   - **GoPro on the right half:** Position **1920, 0**, Size **1920 × 1080**.
3. Select the **Booth** scene and click **Start Virtual Camera**.
4. Start HoloBooth. Which half is which angle is `obsRegion` in each
   `camera.angles.list` entry: 0 = left, 1 = right.

Keep OBS running in the background. If it isn't running, the tiles say so
and the shoot opens the camera directly instead. The camera log records
the size OBS is actually sending, and warns if it isn't 3840x1080.

To start OBS with the virtual camera already on, use a shortcut:
`"C:\Program Files\obs-studio\bin\64bit\obs64.exe" --startvirtualcam --scene "Booth" --minimize-to-tray`
(set the shortcut's "Start in" to that `64bit` folder).

**Camera log:** the operator panel (tap the bottom-left corner 5 times)
has a **Camera log** of everything the camera did: devices seen, what was
opened at what size, drops, freezes and reconnects, and screen changes.
**Copy camera log** puts it on the clipboard to send to whoever is helping.

Cameras with a **micro** HDMI port need a locking or right-angle cable. This is
the single most common failure at an event: someone brushes the cable, the
signal drops, and the next customer gets a black card.

### Real photos with flash (Canon M50 and other DSLR/mirrorless bodies)

With `camera.stills.enabled`, HoloBooth works the way Lumabooth does. The
camera focuses, fires its shutter **and flash**, and the full-resolution
photo goes on the card and strip instead of a video frame. The same USB
cable also carries the live view the customer poses to.

**The camera must support USB remote shooting.** The **Canon EOS M50
does not**: over USB it only gives live view, so it can't fire its shutter
or flash from a computer, in HoloBooth or anything else. Use the M50 as a
video camera instead (EOS Webcam Utility or HDMI, above), with constant
lighting. Canon bodies that do tether well and are common in booths
include the Rebel T6/T7/T7i and SL2/SL3 (2000D/4000D/800D/200D/250D).

**Windows: digiCamControl** (free, [digicamcontrol.com](https://digicamcontrol.com)).
It talks to Canon cameras through Canon's own SDK, the same way Lumabooth does.

1. Install digiCamControl, plug the camera in by USB and open the app.
   Check that it shows the camera and can take a photo.
2. **File → Settings → Webserver:** turn on "Use web server", port 5513,
   then restart digiCamControl. Leave it running (minimised is fine).
3. Start HoloBooth. Open the operator panel (tap the bottom-left corner 5
   times) and press **Take a test photo**. It shows the photo, its size and
   how long it took.

**Mac, Linux or Raspberry Pi: gphoto2** (`brew install gphoto2` or
`sudo apt install gphoto2`). Nothing else to set up. On a Mac, HoloBooth
closes macOS's own camera daemon first, because it grabs the camera on plug-in.

**Camera settings (M50):**
- **Mode:** the dial on **M** or **Av**, not movie mode. Image quality
  **JPEG** (L / Fine), not RAW only.
- **Focus:** AF on, **One-Shot**, **Face + Tracking**. If focus can't
  lock (too dark, nothing in frame), the camera refuses to shoot. HoloBooth
  then uses the live view frame for that shot and keeps going.
- **Flash:** pop up the built-in flash and set it to fire. Better: a
  speedlight on the hot shoe, or a radio trigger (Godox X2T-C) to
  off-camera strobes. Keep the shutter at **1/200 s or slower**, the M50's
  flash sync limit. Lights also help autofocus.
- **Wi-Fi/Bluetooth off**, because the M50 disables USB control while
  they're on.
- **Auto power off disabled.** Use a dummy battery (ACK-E12) for power.
- **Only one program can hold the camera.** Quit Lumabooth, OBS and EOS
  Webcam Utility.

**What to expect:**
- **Timing:** each photo takes about 1–3 s to focus, shoot and transfer,
  with 📸 on screen meanwhile. Live view pauses during that.
- **Live view** from digiCamControl runs at ~10–15 fps. From gphoto2 it's
  only a few fps. For a smooth preview, set `camera.stills.preview` to
  `"video"` and feed an HDMI capture card, while photos still go over USB.
- **The GIF** is built from live view frames, so it's lower resolution
  than the prints.
- **Originals** are kept at full size: digiCamControl and gphoto2 save
  them under the app's data folder in `stills/<date>/`. The kiosk uses a
  copy scaled to `maxDimension` (3000 px), which is plenty for 300 dpi.
- **Fallback:** if the camera can't be reached at the start of a session,
  the booth falls back to the video camera (`preferredLabels`) and shows
  why. A paid customer still gets a shoot.
- **Camera angles:** with several angles, only `camera.stills.angle`
  (default `standard`) uses the tethered camera. The others stay video.

Set `camera.stills.enabled` to `false` to go back to video frames (EOS
Webcam Utility or a capture card, see above).

---

## Payments

**Test vs real, without editing anything:**

| Command | Payments | Window |
|---|---|---|
| `npm run dev` | mock (TEST MODE badge) | windowed + DevTools |
| `npm run start:test` | mock (TEST MODE badge) | full-screen kiosk (rehearsal) |
| `npm run dev:live` | real | windowed + DevTools |
| `npm start` | real (`payments.provider`) | full-screen kiosk (the event) |

On the mock reader, every sale approves after ~2 s. Press **D** on the pay
screen to simulate a decline.

**Card reader and QR together (`payments.offerQr`, on).** With a WisePOS E,
S700 or M2, the pay screen also shows a QR code. The customer taps their
card, or scans and pays on their phone (Apple Pay, Google Pay or card).
The first payment to complete is the sale. The other is stopped: the
reader is cleared, and the QR link is expired so it can't be paid later. A
payment that lands at the same instant, or as the customer presses
Cancel, is refunded automatically, so nobody is charged twice. After a
declined card, a fresh sale goes back on the reader (up to 3 tries) while
the QR stays up. If the reader is offline, the screen falls back to QR
only. After paying by QR, the phone shows a confirmation page from the
server. That page only loads when the server is public (the cloud server
with `PUBLIC_URL`), but the payment goes through either way.

Four providers behind one interface, chosen by `payments.provider`:

- **`mock`** — approves after a beat. Develop against this.
- **`stripe-smart-reader`** — a **WisePOS E** or **S700**. These have their own
  Wi-Fi/Ethernet, so `server/index.js` drives the reader directly over the
  internet: the kiosk creates a sale, the server pushes it to the reader's
  screen (`process_payment_intent`), the customer taps there, and the kiosk
  polls until it's paid. **Just this PC and the reader — no phone, no
  companion app.** Declines and walk-aways are read off the reader's own
  action status, so it works without webhooks configured.
- **`stripe-terminal`** — for a Stripe **M2** reader. The M2 is Bluetooth-only,
  so the kiosk can't drive it directly: the server creates a PaymentIntent
  and hands it off, a **phone running `companion-app/`** pairs with the M2
  over Bluetooth and actually collects the tap, and the kiosk polls the
  server until that session flips to paid — see `companion-app/README.md`.
- **`stripe-qr`** — customer pays on their phone from an on-screen QR. No
  hardware, slower line.

The secret key lives only in `server/index.js`:

```bash
STRIPE_SECRET_KEY=sk_test_... npm run server
```

### Smart reader setup (once per reader)

1. Create a Location in the Stripe Dashboard (Terminal → Locations) and put
   its `tml_...` id in `payments.stripe.locationId`.
2. On the reader: **Settings → Generate pairing code** (three words).
3. Register it:
   ```bash
   STRIPE_SECRET_KEY=sk_live_... npm run reader:register -- sepia-cerulean-aqua
   ```
   It prints a `tmr_...` reader id. (Run it with no code to list readers
   already registered at the location.)
4. In `booth.config.json` set `"provider": "stripe-smart-reader"` and
   `"reader": { "id": "tmr_..." }`, then restart the server. Its startup log
   shows which reader it's driving.

**No hardware yet?** Set `payments.stripe.simulated: true` and start the
server with an `sk_test_` key — it finds or creates a test Location and a
simulated WisePOS E by itself on boot, no registration step. On the kiosk's
pay screen, press **T** to tap a working card or **D** for a decline
(Stripe's `4000000000000002` test card). Refuses to run with a live key,
and never creates anything in your live account.

### Product catalog

`pricing.products` in `booth.config.json` is the source of truth for names
and amounts. Mirror it into real Stripe Products/Prices with:

```bash
STRIPE_SECRET_KEY=sk_test_... npm run stripe:sync
```

This writes `out/stripe-catalog.json`, which `server/index.js` reads on boot
so QR Checkout Sessions reference a real synced Price (dashboard reports and
receipts show the product by name) instead of an inline, unnamed line item.
Re-run it any time a price or product name changes in the config — it
updates in place rather than creating duplicates, archiving the old Price
if the amount changed. Both payment endpoints look the amount up server-side
from `productId`; the kiosk's own `amount` is never trusted. The kiosk does
send the price it showed, and the server refuses the sale (409, "Price
mismatch") if the two copies of the config disagree, so update the server
whenever you change a price.

### Cloud server (download links that work on any phone)

Run locally, the download QR points at `127.0.0.1`, which is the customer's
own phone, so it can't work. It also dies when the booth PC is packed away.
Put `server/index.js` on a ~$5/month VPS instead (DigitalOcean, Hetzner,
Vultr, Lightsail: Ubuntu 24.04, 1 GB RAM). One script sets up Node, HTTPS
(Caddy + Let's Encrypt), a systemd service and the keys:

```bash
ssh root@YOUR.SERVER.IP
curl -fsSL https://raw.githubusercontent.com/a-ch3n/holobooth/main/deploy/setup-vps.sh -o setup-vps.sh
sudo bash setup-vps.sh
```

With no domain it uses `https://<ip-with-dashes>.sslip.io`. With a domain,
point an A record at the server and run `sudo DOMAIN=photos.example.com bash
setup-vps.sh`. It asks for the Stripe secret key, which is stored in
`/etc/holobooth.env` on the server and nowhere else. At the end it prints
two lines for the booth PC. Put them in **`config/booth.config.local.json`**,
which is gitignored:

```json
{ "server": { "url": "https://203-0-113-5.sslip.io", "kioskKey": "…" } }
```

`server.url` points payments, AI names and photo uploads at the VPS, so the
booth PC no longer runs `npm run server` at all. With a smart reader, the
reader and the kiosk both just need internet.

- **The kiosk key.** Everything that takes money, refunds, uploads or spends
  API quota requires the `x-kiosk-key` header once `PUBLIC_URL` is set, and
  the server won't start without one. Download pages, `/qr` and `/health`
  stay open. The key never goes in `booth.config.json`, because this repo is
  public.
- **Download links** are 128-bit random ids, so they can't be guessed, and
  expire after `delivery.retentionDays`. Each sale is roughly 5–10 MB, so a
  25 GB disk holds a few thousand sales.
- **Going live on the server:** put `sk_live_…` in `/etc/holobooth.env`, and
  put the reader id and `"stripe": { "simulated": false }` in the server's
  own `/opt/holobooth/config/booth.config.local.json`, e.g.
  `{ "payments": { "stripe": { "simulated": false }, "reader": { "id": "tmr_…" } } }`,
  then `systemctl restart holobooth`.
- **Webhooks** are optional. Without `STRIPE_WEBHOOK_SECRET` the server
  checks every webhook against Stripe before believing it.
- **Update:** re-run `sudo bash setup-vps.sh`. It pulls, reinstalls and
  restarts, and keeps the keys and photos. Logs: `journalctl -u holobooth -f`.
- **Trade-off:** the upload now crosses the venue's internet before the
  download QR appears. On weak Wi-Fi, that's a few seconds on the reveal
  screen.

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

### Printing on Windows (DNP DS40)

Windows doesn't install DNP's driver by itself. Until it's installed, the
printer won't appear in Windows Settings or in HoloBooth.

1. Download the **DS40 Windows driver** from DNP's support site
   (dnpphoto.com → Support → Drivers).
2. Turn the printer on, plug it in by USB, and run DNP's installer.
3. Check **Settings → Bluetooth & devices → Printers & scanners** lists it.

With `cardPrinterName` / `stripPrinterName` left `null`, HoloBooth finds
the photo printer by name (DNP, Citizen, SELPHY, Mitsubishi and so on)
instead of using the Windows default, which is often "Microsoft Print to
PDF". If there's no photo printer, it says so instead of printing
nowhere. The operator panel marks the printer it will use **PRINTS HERE**.
Windows prints a 6×4 sheet as a **landscape** page (Print method:
**Standard**, the setting that has printed on the DS40). Sending it
portrait asks the DNP driver for a page wider than its 4×6 paper, and it
drops the job. **Driver paper** and **Browser** are alternatives for
other printers.

**Strip cut on Windows:** the DS40's 2-inch cut is a printer-preferences
setting on Windows, not a per-job option. Cards must not be cut, so use
two Windows printer entries for the same DS40, one per job type:
1. Make sure both entries (e.g. "DS40" and "DS40 (Copy 1)") point to the
   same USB port: right-click → Printer properties → Ports.
2. On the one for strips: Printing preferences → turn on the 2-inch cut.
3. In the operator panel, under Printers, tap **Cards** on one and
   **Strips** on the other. **Print test strip sheet** should come out
   as two pieces.

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

Most dye-subs (a DNP DS40 included) only load 4×6 media, so neither a lone
2.5×3.5″ card nor a lone 2×6″ strip can go to the printer as its own page —
there's no media that size loaded. `buildGangSheet()` in `app.js` tiles
copies of whichever one you're printing onto a sheet-sized canvas with
hairline cut marks, and that composed sheet is what actually gets sent as
the print job:

- **Cards** (`printing.sheet`, enabled by default): two 2.5×3.5″ cards side
  by side on a 6×4″ sheet.
- **Strips** (`printing.stripSheet`, enabled by default): two 2×6″ copies of
  the same strip side by side on a 4×6″ sheet — the same layout DNP calls
  "2×6 (4×6 divided)" media, where the printer's own cutter splits the sheet
  into two strips. If a purchase only calls for one strip, the second slot
  just prints blank; nothing extra is charged or given away.

Set either `enabled: false` if your printer actually takes that media size
directly, and it'll fall back to sending a single page at that exact size.

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
  endpoint (`GET /dex?id=`, kiosk key required) works; the phone-entry
  screen doesn't exist.
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
