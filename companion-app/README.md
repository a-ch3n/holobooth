# HoloBooth Reader (companion app)

The phone that pairs with a Stripe Terminal **M2** over Bluetooth and
actually collects the payment. It exists because the M2, unlike the WisePOS
E this project was originally built around, has no network connection of
its own — something with Bluetooth has to sit next to it, and that's this
app, not the booth PC.

## How it fits with the rest of HoloBooth

```
Electron kiosk          server/index.js           this phone app
─────────────           ───────────────           ───────────────
customer picks a   →    POST /sessions       
product, no price       (creates the PaymentIntent,
sent from the kiosk      price from booth.config.json)
                                                →   GET /booths/:id/pending
                                                    (polls, finds the sale)
                                                →   drives the M2 directly
                                                    over Bluetooth via the
                                                    Stripe Terminal SDK
                                                →   POST /sessions/:id/capture
                         (captures the funds)
GET /sessions/:id   ←
(kiosk polls until
"paid", then shoots)
```

Full detail on the server side: `server/index.js`'s `/sessions`,
`/booths/:boothId/pending`, `/sessions/:id/capture` and the
`/webhooks/stripe` handler. The kiosk side is `src/js/payments.js`'s
`StripeTerminalProvider`.

## Setup

You need a **custom dev client**, not Expo Go — `@stripe/stripe-terminal-react-native`
is a native module Expo Go doesn't ship.

```bash
cd companion-app
npm install
npx expo prebuild        # generates ios/ and android/ native projects
npm run ios              # or: npm run android
```

On first launch, the app asks for four things (stored on-device, set once
per phone):

| Field | Where it comes from |
|---|---|
| Server URL | Wherever `server/index.js` runs — the phone needs to reach it, so `127.0.0.1` only works if the phone *is* the booth PC. Usually the booth PC's LAN IP, e.g. `http://192.168.1.50:4242`. |
| Booth ID | `booth.id` in `config/booth.config.json` (e.g. `BOOTH-001`) — has to match exactly, it's how the server knows which sale is this booth's. |
| Stripe Location ID | `payments.stripe.locationId` in the same config — the Location the M2 was registered under in the Stripe Dashboard. |
| App key | Whatever you set `COMPANION_APP_KEY` to on the server. Keeps a random phone from polling your booth's payment sessions. |

Then: **Pair** (scan → tap the M2 in the list → connect), and it drops
straight into **Collect**, which just sits there polling until HoloBooth
creates a sale.

## Server-side setup this depends on

```bash
STRIPE_SECRET_KEY=sk_test_...          # already required
COMPANION_APP_KEY=some-shared-secret   # new — give the same value to the phone
STRIPE_WEBHOOK_SECRET=whsec_...        # optional but recommended — see below
```

Register a webhook endpoint in the Stripe Dashboard pointing at
`https://your-server/webhooks/stripe`, subscribed to at least
`payment_intent.succeeded`, `payment_intent.payment_failed` and
`payment_intent.canceled`. It's belt-and-suspenders: the phone calling
`/sessions/:id/capture` is what actually captures the funds and is enough
on its own, but the webhook keeps the kiosk's session status right even if
the phone loses its connection right after the tap succeeds.

## What's real vs. what needs a real M2 to prove out

This was written and syntax-checked against the documented
`@stripe/stripe-terminal-react-native` API, but **not built or run against
actual hardware** — there's no M2, no iOS/Android build toolchain, and no
Bluetooth stack available in the environment this was written in. Before
using it at a real event:

- Confirm the exact hook method signatures (`discoverReaders`,
  `connectBluetoothReader`, `collectPaymentMethod`, `confirmPaymentIntent`,
  `retrievePaymentIntent`) against whatever SDK version `npm install`
  actually resolves — Stripe has changed these between betas.
- Test the reconnect story: what happens if the M2 goes to sleep or the
  phone's Bluetooth drops mid-collection. `CollectScreen` currently just
  falls back to polling again; it doesn't try to reconnect the reader
  automatically.
- Test two phones pointed at the same booth ID — right now the last one to
  successfully `POST /sessions/:id/capture` wins, there's no lock.
