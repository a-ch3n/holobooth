/**
 * connect-server.mjs — point this booth PC at the HoloBooth server (the
 * cloud server that holds the guests' digital copies and takes payments).
 *
 *   npm run connect-server -- https://203-0-113-5.sslip.io <kiosk key>
 *   npm run connect-server -- off        (back to the server on this PC)
 *
 * deploy/setup-vps.sh prints the exact command at the end. It adds
 *   { "server": { "url": …, "kioskKey": … } }
 * to config/booth.config.local.json and keeps everything else already in
 * that file (printer queues, cameras, event mode). It checks first that the
 * server answers and accepts the key, and changes nothing if it doesn't.
 */
import { createRequire } from 'node:module';
import { existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const { readLocal, writeLocalPatch } = createRequire(import.meta.url)('../electron/local-config.js');
const LOCAL = join(dirname(fileURLToPath(import.meta.url)), '..', 'config', 'booth.config.local.json');
const [arg, key] = process.argv.slice(2);

const fail = msg => { console.error(`\n✗ ${msg}\n`); process.exit(1); };

if (arg === 'off') {
  const local = readLocal(LOCAL) || {};
  if (!local.server) { console.log('This booth is already using the server on this PC.'); process.exit(0); }
  delete local.server;
  writeFileSync(LOCAL, JSON.stringify(local, null, 2));
  console.log('✓ Disconnected: the booth uses the server on this PC again (npm run server). Restart the booth.');
  process.exit(0);
}

if (!arg || !key) {
  fail('Usage: npm run connect-server -- <server address> <kiosk key>\n  Both are printed at the end of the server setup (deploy/setup-vps.sh).');
}
let url;
try { url = new URL(arg); } catch { fail(`"${arg}" isn't a web address. It looks like https://203-0-113-5.sslip.io`); }
if (url.protocol !== 'https:' && !/^(127\.|localhost$)/.test(url.hostname)) {
  fail(`Use the https:// address the setup printed, not ${url.protocol}//`);
}
const base = url.origin;

console.log(`Checking ${base} …`);
let health;
try {
  const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(15000) });
  health = await r.json();
  if (!health.ok) throw new Error(`answered ${r.status}`);
} catch (e) {
  fail(`The server isn't answering at ${base}/health (${e.cause?.code || e.message}).\n  Is the address right, is this PC online, and did the setup finish? On the server: journalctl -u holobooth -n 50`);
}
// /dex needs the kiosk key: 401 means the key is wrong.
const keyCheck = await fetch(`${base}/dex`, { headers: { 'x-kiosk-key': key }, signal: AbortSignal.timeout(15000) }).catch(e => e);
if (keyCheck instanceof Error) fail(`Couldn't check the key: ${keyCheck.message}`);
if (keyCheck.status === 401) fail('The server is up but refused that kiosk key. Copy it again from the end of the setup (or on the server: sudo grep KIOSK_KEY /etc/holobooth.env).');
if (!keyCheck.ok) fail(`The server answered ${keyCheck.status} to the key check.`);

const had = existsSync(LOCAL);
writeLocalPatch(LOCAL, { server: { url: base, kioskKey: key } });
console.log(`✓ Connected to ${base}`);
console.log(`  payments: ${health.stripe ? 'Stripe key set on the server' : 'no Stripe key on the server yet (fine for free events; needed for paid ones)'}`);
console.log(`  saved in config/booth.config.local.json${had ? ' (your other settings in it are kept)' : ''}`);
console.log('  Restart the booth (close it, then npm start). It no longer needs `npm run server`.');
