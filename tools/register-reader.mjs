#!/usr/bin/env node
/**
 * register-reader.mjs — one-time setup for a WisePOS E / S700 smart reader.
 *
 * A smart reader has its own internet connection and is driven by
 * server/index.js directly (payments.provider: 'stripe-smart-reader'), so
 * Stripe needs to know it belongs to your account and location first:
 *
 *   1. On the reader: Settings > Generate pairing code. It shows three words,
 *      e.g. "sepia-cerulean-aqua".
 *   2. STRIPE_SECRET_KEY=sk_live_... npm run reader:register -- sepia-cerulean-aqua
 *   3. Put the printed tmr_... id into payments.reader.id in booth.config.json.
 *
 * With no code, lists the readers already registered at the location — handy
 * if you registered it from the Stripe Dashboard instead.
 *
 * No hardware yet? With a test key, the code `simulated-wpe` registers a
 * simulated WisePOS E, and POST /terminal/simulate-tap on the server "taps" a
 * card on it, so the whole kiosk flow can be run end to end.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'config', 'booth.config.json');

if (!process.env.STRIPE_SECRET_KEY) {
  console.error('Set STRIPE_SECRET_KEY first, e.g.:\n  STRIPE_SECRET_KEY=sk_live_... npm run reader:register -- <pairing-code>');
  process.exit(1);
}
const Stripe = (await import('stripe')).default;
// Same reason as stripe-sync-catalog.mjs: the fetch client honors HTTP(S)_PROXY.
const stripe = Stripe(process.env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const location = config.payments?.stripe?.locationId;
if (!location) {
  console.error('payments.stripe.locationId is not set in booth.config.json — create a Location in the Stripe Dashboard (Terminal > Locations) first.');
  process.exit(1);
}

const [code, ...labelParts] = process.argv.slice(2);
const label = labelParts.join(' ') || `HoloBooth ${config.booth?.id || ''}`.trim();

if (!code) {
  const { data } = await stripe.terminal.readers.list({ location, limit: 100 });
  if (!data.length) {
    console.log(`No readers registered at ${location} yet. Run again with the pairing code from the reader's screen.`);
  } else {
    console.log(`Readers at ${location}:\n`);
    for (const r of data) console.log(`  ${r.id}  ${r.device_type.padEnd(16)} ${r.status.padEnd(8)} ${r.label}`);
    console.log('\nPut the one you want into payments.reader.id in booth.config.json.');
  }
  process.exit(0);
}

if (code.startsWith('simulated') && !process.env.STRIPE_SECRET_KEY.startsWith('sk_test_')) {
  console.error('Simulated readers only exist in test mode — use an sk_test_ key.');
  process.exit(1);
}

const reader = await stripe.terminal.readers.create({ registration_code: code, label, location });
console.log(`Registered ${reader.device_type} "${reader.label}" at ${location}\n`);
console.log(`  Reader id: ${reader.id}\n`);
console.log('Now set, in config/booth.config.json:');
console.log(`  "provider": "stripe-smart-reader"`);
console.log(`  "reader": { "id": "${reader.id}" }`);
console.log('and restart the server.');
