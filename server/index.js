/**
 * HoloBooth local server.
 *
 * Runs on the booth PC (or a small VPS if you want the download links to work
 * off the venue's network). Two responsibilities:
 *
 *   1. Hold the Stripe secret key. The kiosk UI never sees it — it only asks
 *      this server to create and drive PaymentIntents. That is the difference
 *      between a booth you can leave unattended and one you can't.
 *   2. Serve the customer-facing bits: the QR download page, the GIF/photo
 *      files, and the season "dex" that shows which frames someone has
 *      collected.
 *
 *   STRIPE_SECRET_KEY=sk_test_... node server/index.js
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

const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;

fs.mkdirSync(MEDIA_DIR, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json({ limit: '40mb' }));

/* =============================================================== health */

app.get('/health', (_req, res) => res.json({
  ok: true,
  stripe: !!stripe,
  provider: CONFIG.payments?.provider,
  season: CONFIG.collection?.seasonId,
  uptime: process.uptime(),
}));

/* ====================================================== stripe terminal */

function requireStripe(res) {
  if (!stripe) {
    res.status(503).json({ error: 'STRIPE_SECRET_KEY is not set on the server.' });
    return false;
  }
  return true;
}

/** Terminal SDKs exchange this for a session. Kept server-side by design. */
app.post('/terminal/connection_token', async (_req, res) => {
  if (!requireStripe(res)) return;
  try {
    const token = await stripe.terminal.connectionTokens.create();
    res.json({ secret: token.secret });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/terminal/readers', async (_req, res) => {
  if (!requireStripe(res)) return;
  try {
    const params = {};
    if (CONFIG.payments?.stripe?.locationId) params.location = CONFIG.payments.stripe.locationId;
    const readers = await stripe.terminal.readers.list(params);
    res.json(readers.data.map(r => ({
      id: r.id, label: r.label, status: r.status, deviceType: r.device_type, serial: r.serial_number,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/terminal/payment_intent', async (req, res) => {
  if (!requireStripe(res)) return;
  const { amount, currency = 'usd', description, metadata = {} } = req.body;
  try {
    const pi = await stripe.paymentIntents.create({
      amount, currency, description, metadata,
      payment_method_types: ['card_present'],
      capture_method: 'manual', // capture only once the print actually succeeds
    });
    res.json({ id: pi.id, status: pi.status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/terminal/process', async (req, res) => {
  if (!requireStripe(res)) return;
  const { readerId, paymentIntentId } = req.body;
  try {
    const r = await stripe.terminal.readers.processPaymentIntent(readerId, { payment_intent: paymentIntentId });
    res.json({ status: r.action?.status || 'in_progress' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/terminal/payment_intent/:id', async (req, res) => {
  if (!requireStripe(res)) return;
  try {
    const pi = await stripe.paymentIntents.retrieve(req.params.id, { expand: ['latest_charge'] });
    const card = pi.latest_charge?.payment_method_details?.card_present;
    res.json({
      id: pi.id,
      status: pi.status,
      last_payment_error: pi.last_payment_error || null,
      latest_charge_details: card ? { brand: card.brand, last4: card.last4 } : null,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/terminal/capture', async (req, res) => {
  if (!requireStripe(res)) return;
  try {
    const pi = await stripe.paymentIntents.capture(req.body.paymentIntentId);
    res.json({ status: pi.status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/terminal/cancel_action', async (req, res) => {
  if (!requireStripe(res)) return;
  try {
    await stripe.terminal.readers.cancelAction(req.body.readerId);
    res.json({ ok: true });
  } catch (e) { res.status(200).json({ ok: false, error: e.message }); }
});

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
  const { amount, productId, meta } = req.body;
  try {
    const s = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: CONFIG.booth?.currency || 'usd',
          product_data: { name: `HoloBooth — ${productId}` },
          unit_amount: amount,
        },
        quantity: 1,
      }],
      metadata: { productId, ...meta },
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
  console.log(`  stripe: ${stripe ? 'configured' : 'NOT configured (set STRIPE_SECRET_KEY)'}`);
  console.log(`  media:  ${MEDIA_DIR}`);
});
