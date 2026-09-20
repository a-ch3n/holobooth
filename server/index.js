/**
 * HoloBooth local server.
 *
 * Runs on the booth PC (or a small VPS if you want the download links to work
 * off the venue's network). Three responsibilities:
 *
 *   1. Hold the Stripe secret key. The kiosk UI never sees it — it only asks
 *      this server to create and drive PaymentIntents. That is the difference
 *      between a booth you can leave unattended and one you can't.
 *   2. Serve the customer-facing bits: the QR download page, the GIF/photo
 *      files, and the season "dex" that shows which frames someone has
 *      collected.
 *   3. Hold the Google Gemini API key for the "Surprise me" name generator,
 *      same reasoning as Stripe — a browser-executed secret is a published
 *      secret. Gemini's free tier (no credit card) is the point: this is a
 *      nice-to-have for a photo booth, not something worth paying for.
 *
 *   STRIPE_SECRET_KEY=sk_test_... GEMINI_API_KEY=AIza... node server/index.js
 */
const express = require('express');
const cors = require('cors');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const QRCode = require('qrcode');

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'booth.config.json'), 'utf8'));
const PORT = Number(process.env.PORT || 4242);
const MEDIA_DIR = process.env.MEDIA_DIR || path.join(__dirname, '..', 'out', 'media');
const RETENTION_DAYS = CONFIG.delivery?.retentionDays || 30;
const PRODUCTS_BY_ID = new Map((CONFIG.pricing?.products || []).map(p => [p.id, p]));

const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || null;
/** Shared secret the companion phone app sends on every request. Per-booth
 *  in a real multi-booth deployment; one value is enough to start. */
const APP_KEY = process.env.COMPANION_APP_KEY || null;

/**
 * M2 reader sessions. The phone (not this server) drives the reader over
 * Bluetooth — this server only ever creates the PaymentIntent, hands the
 * phone whatever it needs to collect it, and tracks the result. keyed by
 * PaymentIntent id; pendingByBooth points each boothId at its one open one.
 */
const terminalSessions = new Map();
const pendingByBooth = new Map();
const STALE_SESSION_MS = 3 * 60 * 1000;

/**
 * Stripe product/price ids from `npm run stripe:sync` (tools/stripe-sync-catalog.mjs).
 * Optional: the QR checkout falls back to an inline price_data line item
 * when this hasn't been run yet, so a fresh clone still works end to end.
 */
const CATALOG_PATH = path.join(__dirname, '..', 'out', 'stripe-catalog.json');
let STRIPE_CATALOG = {};
try { STRIPE_CATALOG = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8')); } catch { /* not synced yet */ }

/**
 * The price a customer pays comes from booth.config.json, never from the
 * request body — the kiosk sends a productId, and this is the only place
 * that turns it into an amount, so a tampered client can't discount itself.
 */
function requireProduct(req, res) {
  const product = PRODUCTS_BY_ID.get(req.body?.productId);
  if (!product) {
    res.status(400).json({ error: `Unknown productId: ${req.body?.productId}` });
    return null;
  }
  return product;
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || null;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

fs.mkdirSync(MEDIA_DIR, { recursive: true });

const app = express();
app.use(cors());

/**
 * Stripe webhooks need the raw request body to verify the signature, so this
 * has to be mounted before the app-wide express.json() below swallows it.
 */
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), (req, res) => {
  if (!stripe) return res.status(503).end();
  let event;
  try {
    event = STRIPE_WEBHOOK_SECRET
      ? stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET)
      : JSON.parse(req.body);
  } catch (e) {
    console.error('[webhook] signature check failed:', e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  const pi = event.data?.object;
  const boothSession = pi && terminalSessions.get(pi.id);
  if (boothSession) {
    if (event.type === 'payment_intent.succeeded') {
      boothSession.status = 'paid';
      const card = pi.charges?.data?.[0]?.payment_method_details?.card_present;
      if (card) { boothSession.brand = card.brand; boothSession.last4 = card.last4; }
      if (pendingByBooth.get(boothSession.boothId) === pi.id) pendingByBooth.delete(boothSession.boothId);
    } else if (event.type === 'payment_intent.payment_failed' || event.type === 'payment_intent.canceled') {
      boothSession.status = 'failed';
      boothSession.error = pi.last_payment_error?.message || 'Payment failed';
      if (pendingByBooth.get(boothSession.boothId) === pi.id) pendingByBooth.delete(boothSession.boothId);
    }
  }
  res.json({ received: true });
});

app.use(express.json({ limit: '40mb' }));

/* =============================================================== health */

app.get('/health', (_req, res) => res.json({
  ok: true,
  stripe: !!stripe,
  stripeCatalogSynced: Object.keys(STRIPE_CATALOG).length,
  ai: !!GEMINI_API_KEY,
  provider: CONFIG.payments?.provider,
  season: CONFIG.collection?.seasonId,
  uptime: process.uptime(),
}));

/* ========================================================= ai name gen */

/**
 * "Surprise me" character names, via Google's Gemini API — free tier, no
 * credit card required (see https://ai.google.dev/gemini-api/docs/pricing).
 * The kiosk's own word-list generator is the default and the fallback —
 * this only makes the result more varied when a key is configured and the
 * venue's connection answers in time. Never required for the booth to work.
 */
app.post('/ai/name', async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(503).json({ error: 'GEMINI_API_KEY is not set on the server.' });
  }
  const theme = String(req.body?.theme || '').replace(/[^a-z ]/gi, '').slice(0, 40);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const r = await fetch(url, {
      method: 'POST',
      signal: ac.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: 'Invent one short, fun two-word trading-card character alias'
              + (theme ? ` with a ${theme} energy vibe` : '')
              + '. Style: a superhero nickname, e.g. "Blaze Fox" or "Cosmic Drift". '
              + 'Reply with ONLY the two words — no quotes, no punctuation, no explanation.',
          }],
        }],
        // Generous headroom: some Gemini models spend part of the token
        // budget "thinking" before the visible answer, so a tight budget can
        // come back empty. The two-word answer itself needs almost none of it.
        generationConfig: { maxOutputTokens: 200 },
      }),
    });
    if (!r.ok) throw new Error(`Gemini API ${r.status}`);
    const data = await r.json();
    const raw = (data.candidates || []).flatMap(c => c.content?.parts || []).map(p => p.text || '').join('');
    const words = raw.replace(/[^a-zA-Z' -]/g, '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
    const name = words.join(' ').slice(0, 24);
    if (!name) throw new Error('empty response');
    res.json({ name });
  } catch (e) {
    res.status(502).json({ error: e.name === 'AbortError' ? 'timed out' : e.message });
  } finally {
    clearTimeout(timer);
  }
});

/* ============================================ stripe terminal (M2 + phone) */

/**
 * An M2 reader is Bluetooth-only — this server never talks to it directly.
 * A phone running the Stripe Terminal SDK pairs with the M2 over Bluetooth,
 * polls this server for the sale it should collect, and drives the reader
 * itself. This server's whole job is: decide the price, create the
 * PaymentIntent, hand it to whichever phone asks, and track the result —
 * exactly the same "the client never sets its own price" rule the QR and
 * card-catalog flows already follow (see requireProduct above).
 */

function requireStripe(res) {
  if (!stripe) {
    res.status(503).json({ error: 'STRIPE_SECRET_KEY is not set on the server.' });
    return false;
  }
  return true;
}

/** The companion app sends this on every call; keeps randoms from polling client secrets off your booth. */
function requireAppKey(req, res, next) {
  if (!APP_KEY) return next(); // no key configured — fine for local dev, set COMPANION_APP_KEY for a real event
  if (req.get('x-app-key') !== APP_KEY) return res.status(401).json({ error: 'bad or missing x-app-key' });
  next();
}

/** Terminal SDKs (the phone's, in this setup) exchange this for a session. Kept server-side by design. */
app.post('/terminal/connection_token', requireAppKey, async (_req, res) => {
  if (!requireStripe(res)) return;
  try {
    const token = await stripe.terminal.connectionTokens.create();
    res.json({ secret: token.secret });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** HoloBooth creates the sale here — a productId and a boothId, never an amount. */
app.post('/sessions', async (req, res) => {
  if (!requireStripe(res)) return;
  const product = requireProduct(req, res);
  if (!product) return;
  const { boothId, metadata = {} } = req.body;
  if (!boothId) return res.status(400).json({ error: 'boothId is required' });
  const currency = CONFIG.booth?.currency || 'usd';
  try {
    const pi = await stripe.paymentIntents.create({
      amount: product.amount,
      currency,
      description: `${product.name} — HoloBooth`,
      metadata: { productId: product.id, boothId, ...metadata },
      payment_method_types: ['card_present'],
      capture_method: 'manual', // capture only once the phone confirms the tap succeeded
    });
    terminalSessions.set(pi.id, {
      boothId, productId: product.id, amount: product.amount, currency,
      status: 'pending', createdAt: Date.now(),
    });
    pendingByBooth.set(boothId, pi.id);
    res.json({ sessionId: pi.id, amount: product.amount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** The companion app polls this to find the sale it should collect on the M2. */
app.get('/booths/:boothId/pending', requireAppKey, async (req, res) => {
  if (!requireStripe(res)) return;
  const id = pendingByBooth.get(req.params.boothId);
  if (!id) return res.json({ pending: null });
  try {
    const pi = await stripe.paymentIntents.retrieve(id);
    if (!['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(pi.status)) {
      // Already collected (or dead) by the time this poll landed — nothing left to hand out.
      pendingByBooth.delete(req.params.boothId);
      return res.json({ pending: null });
    }
    res.json({ pending: { id: pi.id, amount: pi.amount, currency: pi.currency, clientSecret: pi.client_secret } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** HoloBooth polls this — same shape as the QR flow's session poll — until status flips to "paid". */
app.get('/sessions/:id', async (req, res) => {
  if (!requireStripe(res)) return;
  const cached = terminalSessions.get(req.params.id);
  try {
    const pi = await stripe.paymentIntents.retrieve(req.params.id);
    const card = pi.charges?.data?.[0]?.payment_method_details?.card_present;
    res.json({
      id: pi.id,
      status: cached?.status === 'paid' || pi.status === 'succeeded' ? 'paid'
        : cached?.status === 'failed' || pi.status === 'canceled' ? 'failed'
        : 'pending',
      amount: pi.amount,
      error: cached?.error || pi.last_payment_error?.message || null,
      brand: cached?.brand || card?.brand || null,
      last4: cached?.last4 || card?.last4 || null,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * The companion app calls this right after the Terminal SDK confirms the
 * tap on the M2 (which brings a manual-capture PaymentIntent to
 * requires_capture, not all the way to succeeded). The payment_intent.
 * succeeded webhook above is the belt-and-suspenders path if the phone
 * loses its connection before this call lands.
 */
app.post('/sessions/:id/capture', requireAppKey, async (req, res) => {
  if (!requireStripe(res)) return;
  try {
    const pi = await stripe.paymentIntents.capture(req.params.id);
    const session = terminalSessions.get(req.params.id);
    if (session) {
      session.status = 'paid';
      const card = pi.charges?.data?.[0]?.payment_method_details?.card_present;
      if (card) { session.brand = card.brand; session.last4 = card.last4; }
      if (pendingByBooth.get(session.boothId) === req.params.id) pendingByBooth.delete(session.boothId);
    }
    res.json({ status: pi.status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** Customer walked away, or HoloBooth timed out waiting — free up the booth for the next one. */
app.post('/sessions/:id/cancel', async (req, res) => {
  if (!requireStripe(res)) return;
  const session = terminalSessions.get(req.params.id);
  try {
    await stripe.paymentIntents.cancel(req.params.id).catch(() => {}); // already captured/canceled is fine
    if (session) {
      session.status = 'failed';
      session.error = 'cancelled';
      if (pendingByBooth.get(session.boothId) === req.params.id) pendingByBooth.delete(session.boothId);
    }
    res.json({ ok: true });
  } catch (e) { res.status(200).json({ ok: false, error: e.message }); }
});

/** Nobody walks away cleanly every time — sweep sessions a customer abandoned mid-tap. */
setInterval(() => {
  const cutoff = Date.now() - STALE_SESSION_MS;
  for (const [id, session] of terminalSessions) {
    if (session.status === 'pending' && session.createdAt < cutoff) {
      stripe?.paymentIntents.cancel(id).catch(() => {});
      session.status = 'failed';
      session.error = 'timed out';
      if (pendingByBooth.get(session.boothId) === id) pendingByBooth.delete(session.boothId);
    }
  }
}, 30000).unref();

/** Refund the last sale — the operator panel's "print jammed, give it back" button. */
app.post('/terminal/refund', async (req, res) => {
  if (!requireStripe(res)) return;
  try {
    const refund = await stripe.refunds.create({ payment_intent: req.body.paymentIntentId });
    res.json({ id: refund.id, status: refund.status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ================================================== qr checkout (phone) */

const sessions = new Map();

app.post('/checkout/session', async (req, res) => {
  if (!requireStripe(res)) return;
  const product = requireProduct(req, res);
  if (!product) return;
  const { meta } = req.body;
  const cataloged = STRIPE_CATALOG[product.id];
  try {
    const s = await stripe.checkout.sessions.create({
      mode: 'payment',
      // Prefer the synced catalog Price so the sale shows up in Stripe
      // against a real Product (see tools/stripe-sync-catalog.mjs); fall
      // back to an inline line item if `npm run stripe:sync` hasn't run yet.
      line_items: [cataloged
        ? { price: cataloged.stripePriceId, quantity: 1 }
        : {
            price_data: {
              currency: CONFIG.booth?.currency || 'usd',
              product_data: { name: `HoloBooth — ${product.name}` },
              unit_amount: product.amount,
            },
            quantity: 1,
          }],
      metadata: { productId: product.id, ...meta },
      success_url: `${req.protocol}://${req.get('host')}/checkout/done`,
      cancel_url: `${req.protocol}://${req.get('host')}/checkout/done`,
    });
    sessions.set(s.id, { paid: false, createdAt: Date.now() });
    res.json({ sessionId: s.id, url: s.url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/checkout/session/:id', async (req, res) => {
  if (!requireStripe(res)) return;
  try {
    const s = await stripe.checkout.sessions.retrieve(req.params.id);
    res.json({ paid: s.payment_status === 'paid', expired: s.status === 'expired' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/checkout/done', (_req, res) =>
  res.send('<h2 style="font:600 22px system-ui;text-align:center;margin-top:20vh">All set — look back at the booth.</h2>'));

/* ================================================================ media */

/** Kiosk uploads the finished card / strip / GIF and gets back a short link. */
app.post('/media', (req, res) => {
  const { files = [], collectorId = null, card = null } = req.body;
  const id = crypto.randomBytes(4).toString('hex');
  const dir = path.join(MEDIA_DIR, id);
  fs.mkdirSync(dir, { recursive: true });

  const saved = [];
  for (const f of files) {
    const safe = String(f.name).replace(/[^a-z0-9._-]/gi, '_');
    const b64 = String(f.dataUrl).split(',')[1] || '';
    fs.writeFileSync(path.join(dir, safe), Buffer.from(b64, 'base64'));
    saved.push(safe);
  }
  fs.writeFileSync(path.join(dir, 'meta.json'),
    JSON.stringify({ id, collectorId, card, files: saved, at: new Date().toISOString() }, null, 2));

  const base = CONFIG.delivery?.downloadBaseUrl || `${req.protocol}://${req.get('host')}/d`;
  res.json({ id, url: `${base}/${id}`, files: saved });
});

app.get('/d/:id', (req, res) => {
  const dir = path.join(MEDIA_DIR, req.params.id);
  if (!fs.existsSync(dir)) return res.status(404).send('This link has expired.');
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const items = meta.files.map(f =>
    `<a class="tile" href="/d/${meta.id}/${f}" download>
       ${/\.(png|jpg|gif)$/i.test(f) ? `<img src="/d/${meta.id}/${f}" alt="">` : ''}
       <span>${f}</span></a>`).join('');
  res.send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Your HoloBooth pull</title>
  <style>
    body{margin:0;background:#0d0f14;color:#e8ecf4;font:16px/1.5 system-ui,-apple-system,sans-serif;padding:24px}
    h1{font-size:20px;margin:0 0 4px} p{color:#98a2b8;margin:0 0 20px;font-size:14px}
    .grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}
    .tile{display:block;background:#171b24;border:1px solid #262c3a;border-radius:14px;padding:10px;
          color:#cbd3e2;text-decoration:none;text-align:center;font-size:12px}
    .tile img{width:100%;border-radius:8px;display:block;margin-bottom:8px}
    .card{background:#171b24;border:1px solid #262c3a;border-radius:14px;padding:14px;margin-bottom:18px}
    b{color:#ffd76e}
  </style>
  <h1>Your pull is ready</h1>
  <p>Tap any image to save it. Links expire after ${RETENTION_DAYS} days.</p>
  ${meta.card ? `<div class="card">${meta.card.rarityLabel} · <b>${meta.card.serial}</b><br>${meta.card.seasonId}</div>` : ''}
  <div class="grid">${items}</div>`);
});

app.get('/d/:id/:file', (req, res) => {
  const f = path.join(MEDIA_DIR, req.params.id, path.basename(req.params.file));
  if (!fs.existsSync(f)) return res.sendStatus(404);
  res.sendFile(f);
});

app.get('/qr', async (req, res) => {
  try {
    const png = await QRCode.toBuffer(String(req.query.url || ''), { width: 512, margin: 1 });
    res.type('png').send(png);
  } catch (e) { res.status(400).send(e.message); }
});

/* ================================================================== dex */

/** "Collect them all" — what this collector has pulled this season. */
app.get('/dex', (req, res) => {
  const who = req.query.id;
  const rows = [];
  for (const id of fs.readdirSync(MEDIA_DIR)) {
    const mf = path.join(MEDIA_DIR, id, 'meta.json');
    if (!fs.existsSync(mf)) continue;
    const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
    if (who && m.collectorId !== who) continue;
    if (m.card) rows.push(m.card);
  }
  const owned = new Set(rows.map(r => r.frameId));
  res.json({ collectorId: who || null, owned: [...owned], count: owned.size, cards: rows });
});

/* ============================================================== cleanup */

setInterval(() => {
  const cutoff = Date.now() - RETENTION_DAYS * 864e5;
  for (const id of fs.readdirSync(MEDIA_DIR)) {
    const dir = path.join(MEDIA_DIR, id);
    try { if (fs.statSync(dir).mtimeMs < cutoff) fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}, 6 * 3600e3).unref();

app.listen(PORT, () => {
  console.log(`HoloBooth server on http://127.0.0.1:${PORT}`);
  console.log(`  stripe:  ${stripe ? 'configured' : 'NOT configured (set STRIPE_SECRET_KEY)'}`);
  console.log(`  catalog: ${Object.keys(STRIPE_CATALOG).length ? `${Object.keys(STRIPE_CATALOG).length} products synced` : 'not synced — run `npm run stripe:sync`'}`);
  console.log(`  media:   ${MEDIA_DIR}`);
});
