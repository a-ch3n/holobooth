# HoloBooth event guide

How to run HoloBooth for different kinds of events: free events where the
host has paid for the booth, paid public events, and everything in between.
It also covers how guests get their digital photos.

---

## 1. Pick an event mode

| Event mode | Use it for | What guests see | What you need |
|---|---|---|---|
| **Free event** | Weddings, birthdays, school dances, corporate and brand events: anything where the **host pays you** for the booth | Pick a frame, pick a package marked **Free**, shoot. No pay screen. | Booth PC, cameras, printer |
| **Card reader + QR** | Public pop-ups: malls, markets, fairs, festivals. Guests pay per session. | A pay screen with the price. They **tap their card on the WisePOS E**, or **scan a QR code** and pay on their phone. | Everything above, plus a Stripe account, a WisePOS E reader and the payment server |
| **QR only** | Paid events without a card reader (e.g. before the reader arrives, or a second booth) | A pay screen with a QR code. Guests pay on their own phone (Apple Pay, Google Pay or card). | Stripe account and the payment server. No reader. |
| *Test mode* | Practising at home | A yellow **TEST MODE** badge. Every payment is approved after 2 seconds. Press **D** to fake a decline. | Nothing. Just run `npm run dev`. |

### Switching modes

1. Start the booth.
2. Open the **operator screen**: tap the **bottom-left corner 5 times**.
3. Under **System → Event mode**, tap **Free event**, **Card reader + QR** or **QR only**.

The booth screen restarts in that mode. The choice is saved on this PC
only, so `git pull` never changes it.

### Starting the booth

| Command | When |
|---|---|
| `npm start` | **At the event.** Full screen, using the event mode you picked. |
| `npm run dev` | Testing at home. Windowed, and paid modes become **test mode** so no real money moves. A free event stays free. |
| `npm run start:test` | A full-screen rehearsal with test payments. |
| `npm run dev:live` | Testing real payments in a window (with a `sk_test_` key, no real money). |

---

## 2. Event playbooks

### Private party, wedding, birthday (Free event)

The host pays you a flat fee; guests use the booth as much as they like.

- **Event mode:** **Free event**.
- **Packages:** every package shows **Free**, so guests choose what they
  want (a card, a strip, or both). Each guest gets up to **3 retakes**.
- **Digital photos:** guests scan **"Scan to keep it"** on the result screen
  (see section 3). Every session is also saved on the booth PC, so you can
  hand the host **all the photos** after the event: operator screen →
  **Open photos folder**.
- **Their names on every strip:** in `config/booth.config.json`, set
  `strips.event`: `title` ("Sarah & James"), `date` (`2026-06-14`),
  `message` ("Thank you for celebrating with us"), and optionally a `logo`
  PNG. The Strip Collection and Jumbo Strips designs print them. Good fits:
  **Keepsake** (weddings), **Love Letter** (couples), **Party Pop**
  (birthdays), **Grand Gallery** (Jumbo, for a premium keepsake).
- **Tip:** bring extra paper and ribbon. Free booths print a lot more. A
  DS40 6×4 roll is about 400 sheets.

### Public pop-up: mall, market, fair (Card reader + QR)

Guests pay per session.

- **Event mode:** **Card reader + QR**.
- **Prices** are set per package (section 5). Guests either tap their card
  on the reader or scan the QR and pay on their phone. Whichever completes
  first is the sale, and the other is cancelled, so nobody is charged twice.
- **Before the doors open:** do one real sale with your own card and refund
  it in the Stripe Dashboard. That proves the reader, the server and the
  payout all work.
- **Internet is required:** the reader, the payment server and the download
  page all need it. Bring a mobile hotspot as a backup.

### Paid event without a card reader (QR only)

- **Event mode:** **QR only**.
- Slower than tapping a card (guests take 20–30 seconds on their phone),
  but it needs no hardware.

### Brand or corporate activation (Free event)

- **Event mode:** **Free event**. The client pays you.
- Digital sharing is usually the point at these events, so set up the
  **cloud server** (section 3) so every guest can download their photos,
  even on mobile data.

---

## 3. How guests get their digital photos

After the photos are printed, the result screen shows a **"Scan to keep
it"** QR code. The guest scans it with their phone camera and gets a page
with:

- their **card** and/or **photo strip** (the same images that were printed)
- each **individual photo** from the shoot
- the **animated GIF** (boomerang), when the package includes it

They tap an image to save it. Links stay up for **30 days**
(`delivery.retentionDays` in `config/booth.config.json`), then they're
deleted automatically.

### Which setup to use

| Setup | Works for | How |
|---|---|---|
| **Cloud server** (recommended) | **Every guest**, on Wi-Fi or mobile data, and the links keep working after you pack up | A ~$6/month server. One-time setup: see **README → Cloud server**. Then the booth PC needs only `config/booth.config.local.json` with the server's address and key. |
| **Booth PC only** | Guests on the **same Wi-Fi** as the booth PC, while the booth is running | Run `npm run server` in a second window. The QR points at the PC's Wi-Fi address. Many venue Wi-Fis block this, and it stops working when the PC is off. |
| **Print only** | Events where nobody needs a digital copy | Set `"uploadEnabled": false` under `delivery` in the config. No QR is shown. |

### Getting all the photos yourself

Every session's card, strip, photos and GIF are saved on the booth PC,
whatever the setup above, in one folder per day:

- operator screen → **System → Open photos folder**, or
- `%APPDATA%\HoloBooth\holobooth\media\` (one folder per date)

File names start with the time of the session (e.g. `143205-strip.png`),
so they sort in order. Copy that folder to a USB stick or Google Drive for
the host.

---

## 4. Event-day checklist

Do these in this order:

1. **Cameras:** plug in the Logitech Brio and the M50 (over USB with EOS
   Webcam Utility, or HDMI into the capture card, whichever
   `cameras.wide.mode` says). On the M50: Movie mode, clean screen (INFO),
   auto power off disabled, dummy battery. Quit Canon EOS Utility.
2. **Printer:** turn the DS40 on and check paper and ribbon.
3. **Internet:** connect, plus a hotspot as a backup, if you're taking
   payments or using downloads.
4. **Start the booth:** `npm start`.
5. **Operator screen** (bottom-left corner × 5):
   - **Event mode** is the one you want.
   - **Cameras:** both say which device they matched (not "not found").
     **Camera diagnostics** opens each camera in turn and shows its
     picture and real resolution.
   - **Printers:** press **Test print 4x6**, **Test print cards** (and
     **Test print strips** if you sell strips). The black edge line and red
     line 20 px in should show, TOP ↑ should be the right way up, and
     strips should come out as two pieces.
   - **Preview mode** is on until you turn it off: test prints and sales
     only show a preview and save a PDF. When the previews look right,
     operator panel → **Camera diagnostics** → **Turn preview mode OFF**.
     The operator panel's Printers box says which mode is on.
6. **Paid events:** one real sale with your own card, then refund it.
7. During the event, the **Camera log** in the operator screen records
   what went wrong if something does. **Copy camera log** and send it to
   whoever is helping you.

---

## 5. Prices and packages

Packages and prices live in `config/booth.config.json` under
`pricing.products`. Amounts are in **cents** (`1200` = $12.00):

| Package (as shown on screen) | Price | Prints |
|---|---|---|
| 1 Pokémon Card | $7 | 1 card |
| 2 Pokémon Cards | $12 | 2 cards |
| Digital Pokémon Card | $5 | download only |
| Digital Photo Strip | $5 | download only |
| 2 Photo Strips | $7 | 2 strips |
| 1 Pokémon Card + 1 Photo Strip | $12 | 1 card + 1 strip |
| 2 Pokémon Cards + 2 Photo Strips | $18 | 2 cards + 2 strips |
| Jumbo Photo Strip | $10 | 1 Jumbo 4×6 strip |
| 2 Jumbo Photo Strips | $16 | 2 Jumbo 4×6 strips |

Every package includes the digital download.

**After changing a price:** if you use the cloud server, update it too.
SSH in and re-run `sudo BRANCH=claude/serene-pascal-e0365q bash setup-vps.sh`.
The server sets the price the reader charges, and it refuses a sale whose
price doesn't match the booth screen. Optionally run `npm run stripe:sync`
so Stripe's receipts and reports show the new prices.

In a **Free event**, prices are ignored and every package shows **Free**.
To show different wording, change `payments.freeLabel` (e.g. `"Included"`).
