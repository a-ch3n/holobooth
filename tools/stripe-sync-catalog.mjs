#!/usr/bin/env node
/**
 * stripe-sync-catalog.mjs — mirror booth.config.json's pricing.products into
 * a real Stripe product catalog.
 *
 * Without this, every sale hits Stripe as an anonymous amount: the Terminal
 * PaymentIntent carries a bare `amount`, and the QR Checkout Session builds
 * an inline `price_data` blob. Dashboard reports, tax settings and revenue
 * recognition all want a real Product/Price behind a charge, not a number
 * that happened to match one at checkout time.
 *
 * This script is the one-way sync: booth.config.json is the source of truth
 * for names and amounts, Stripe is downstream. Run it after any pricing
 * change:
 *
 *   STRIPE_SECRET_KEY=sk_test_... node tools/stripe-sync-catalog.mjs
 *
 * Each product gets a stable Stripe product id (`holobooth_<productId>`) so
 * reruns update in place instead of piling up duplicates. Stripe prices are
 * immutable once created, so a changed amount doesn't edit the old Price —
 * it archives it and mints a new one, then repoints the product's
 * default_price. Old prices are kept (archived, not deleted) because past
 * PaymentIntents and Checkout Sessions still reference them.
 *
 * Writes out/stripe-catalog.json — {productId -> {stripeProductId,
 * stripePriceId, amount, currency}} — which server/index.js reads at boot to
 * put real Price ids on Checkout Sessions instead of inline price_data.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'booth.config.json');
const OUT_PATH = path.join(ROOT, 'out', 'stripe-catalog.json');

if (!process.env.STRIPE_SECRET_KEY) {
  console.error('Set STRIPE_SECRET_KEY first, e.g.:\n  STRIPE_SECRET_KEY=sk_test_... node tools/stripe-sync-catalog.mjs');
  process.exit(1);
}
const stripe = (await import('stripe')).default(process.env.STRIPE_SECRET_KEY);

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const currency = config.booth?.currency || 'usd';
const products = config.pricing?.products || [];
if (!products.length) {
  console.error('config.pricing.products is empty — nothing to sync.');
  process.exit(1);
}

/** Deterministic id so reruns find the same Stripe object instead of duplicating it. */
const stripeProductId = productId => `holobooth_${productId}`;

async function upsertProduct(p) {
  const id = stripeProductId(p.id);
  const desired = {
    name: p.name,
    description: p.blurb || undefined,
    metadata: { holobooth_product_id: p.id },
  };

  let product;
  try {
    product = await stripe.products.retrieve(id);
    const changed = product.name !== desired.name || (product.description || null) !== (desired.description || null);
    if (changed) product = await stripe.products.update(id, desired);
  } catch (e) {
    if (e.code !== 'resource_missing') throw e;
    product = await stripe.products.create({ id, ...desired });
  }
  return product;
}

/** Prices are immutable — reuse a matching one, or archive-and-replace on a real change. */
async function upsertPrice(product, p) {
  const lookupKey = `holobooth_${p.id}`;
  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 });
  const current = existing.data[0];
  if (current && current.unit_amount === p.amount && current.currency === currency && current.active) {
    return current;
  }

  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: p.amount,
    currency,
    // Stripe rejects a lookup_key already in use, even by an archived price —
    // deactivate the old one *before* creating the replacement.
    ...(current ? {} : { lookup_key: lookupKey }),
    metadata: { holobooth_product_id: p.id },
  });

  if (current) {
    await stripe.prices.update(current.id, { active: false, lookup_key: null });
    await stripe.prices.update(price.id, { lookup_key: lookupKey });
  }
  await stripe.products.update(product.id, { default_price: price.id });
  return price;
}

const catalog = {};
for (const p of products) {
  const product = await upsertProduct(p);
  const price = await upsertPrice(product, p);
  catalog[p.id] = {
    stripeProductId: product.id,
    stripePriceId: price.id,
    amount: p.amount,
    currency,
  };
  console.log(`${p.id.padEnd(16)} ${product.id}  ${price.id}  ${(p.amount / 100).toFixed(2)} ${currency}`);
}

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(catalog, null, 2) + '\n');
console.log(`\nWrote ${path.relative(ROOT, OUT_PATH)} — restart server/index.js to pick it up.`);
