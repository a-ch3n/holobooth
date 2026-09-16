/**
 * kiosk-server.mjs — the device service for the Raspberry Pi build.
 *
 * On desktop, Electron's main process owns printing, storage and window
 * management. A Pi doesn't want Electron: it's a ~250MB runtime that ships its
 * own Chromium, and Raspberry Pi OS already has a perfectly good Chromium that
 * is built for this hardware and video-accelerated on it.
 *
 * So the split becomes:
 *   Chromium --kiosk   the same UI, unchanged
 *   this service       everything the browser can't do — CUPS printing,
 *                      the card/sales ledgers, GPIO buttons, config
 *
 * The UI reaches it through src/js/bridge.js over JSON-RPC, which is why the
 * app code is identical on both platforms.
 *
 *   node pi/kiosk-server.mjs
 */

import { createServer } from 'node:http';
import { readFile, writeFile, appendFile, stat, mkdir } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostname, arch, platform as osPlatform, loadavg, totalmem, freemem } from 'node:os';
import { printImage, listPrinters } from './print.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = join(ROOT, 'config', 'booth.config.json');
const PORT = Number(process.env.PORT || 4180);
const DATA_DIR = process.env.HOLOBOOTH_DATA || join(ROOT, 'data');

let config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
await mkdir(DATA_DIR, { recursive: true });

/* ============================================================== ledgers */

/**
 * Append-only JSONL. On a Pi this matters more than on a desktop: the booth
 * loses power when somebody unplugs it, and an fsync'd append survives that
 * where a half-written database file does not.
 */
const ledgerPath = name => join(DATA_DIR, name);

async function appendLedger(name, row) {
  await appendFile(ledgerPath(name), JSON.stringify(row) + '\n');
}

function readLedger(name) {
  try {
    return readFileSync(ledgerPath(name), 'utf8')
      .split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

/* ================================================================= RPC */

const METHODS = {
  'config.get': () => config,
  'config.save': async next => {
    config = next;
    await writeFile(CONFIG_PATH, JSON.stringify(next, null, 2));
    return true;
  },
  'config.reload': () => (config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))),

  'printers.list': () => listPrinters(),
  'printers.print': args => {
    if (config.printing?.enabled === false) return { ok: false, reason: 'Printing is disabled in booth.config.json' };
    return printImage({
      ...args,
      lpOptions: config.printing?.lpOptions || [],
      dryRun: !!config.printing?.dryRun,
    });
  },

  'cards.nextMint': ({ seasonId, frameId }) =>
    readLedger('cards.jsonl').filter(r => r.seasonId === seasonId && r.frameId === frameId).length + 1,
  'cards.record': async card => { await appendLedger('cards.jsonl', card); return true; },
  'cards.stats': ({ seasonId }) => {
    const rows = readLedger('cards.jsonl').filter(r => r.seasonId === seasonId);
    const byFrame = {}, byRarity = {};
    for (const r of rows) {
      byFrame[r.frameId] = (byFrame[r.frameId] || 0) + 1;
      byRarity[r.rarity] = (byRarity[r.rarity] || 0) + 1;
    }
    return { total: rows.length, byFrame, byRarity, recent: rows.slice(-12).reverse() };
  },

  'sales.record': async sale => { await appendLedger('sales.jsonl', sale); return true; },
  'sales.summary': () => {
    const rows = readLedger('sales.jsonl');
    const today = new Date().toDateString();
    const todays = rows.filter(r => new Date(r.at).toDateString() === today);
    const sum = a => a.reduce((t, r) => t + (r.amount || 0), 0);
    return {
      todayCount: todays.length, todayGross: sum(todays),
      allCount: rows.length, allGross: sum(rows),
      byProduct: rows.reduce((m, r) => ((m[r.productId] = (m[r.productId] || 0) + 1), m), {}),
    };
  },

  'media.save': async ({ name, dataUrl }) => {
    const dir = join(DATA_DIR, 'media', new Date().toISOString().slice(0, 10));
    await mkdir(dir, { recursive: true });
    const file = join(dir, String(name).replace(/[^a-z0-9._-]/gi, '_'));
    await writeFile(file, Buffer.from(String(dataUrl).split(',')[1] || '', 'base64'));
    return file;
  },

  'app.info': () => ({
    version: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version,
    platform: `${osPlatform()}/${arch()}`,
    model: piModel(),
    hostname: hostname(),
    dataDir: DATA_DIR,
    load: loadavg().map(n => n.toFixed(2)).join(' '),
    memMB: Math.round((totalmem() - freemem()) / 1048576) + '/' + Math.round(totalmem() / 1048576),
    temp: cpuTemp(),
    dev: false,
  }),
  'app.quit': () => { setTimeout(() => process.exit(0), 200); return true; },
};

function piModel() {
  try { return readFileSync('/proc/device-tree/model', 'utf8').replace(/\0/g, '').trim(); }
  catch { return 'unknown'; }
}
function cpuTemp() {
  try { return (Number(readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8')) / 1000).toFixed(1) + '°C'; }
  catch { return null; }
}

/* ======================================================== GPIO -> SSE */

const inputClients = new Set();

/**
 * Broadcast a physical button press to the kiosk. The GPIO watcher
 * (pi/gpio-button.py) POSTs here; the browser holds an EventSource open.
 * Debounced on the Python side, where the hardware actually is.
 */
function broadcastInput(ev) {
  const payload = `event: button\ndata: ${JSON.stringify(ev)}\n\n`;
  for (const res of inputClients) { try { res.write(payload); } catch {} }
}

/* ============================================================== static */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.ico': 'image/x-icon',
};

const readBody = req => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  req.on('data', c => {
    size += c.length;
    if (size > 64 * 1024 * 1024) { reject(new Error('body too large')); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = decodeURIComponent(url.pathname);

  try {
    if (path === '/api/health') {
      return json(res, 200, { ok: true, platform: 'pi', model: piModel(), version: 1 });
    }

    if (path === '/api/rpc' && req.method === 'POST') {
      const { method, args } = JSON.parse(await readBody(req));
      const fn = METHODS[method];
      if (!fn) return json(res, 404, { error: `unknown method: ${method}` });
      try {
        return json(res, 200, { result: await fn(args) });
      } catch (e) {
        console.error(`[rpc] ${method}:`, e.message);
        return json(res, 200, { error: e.message });
      }
    }

    // Physical button stream for the kiosk.
    if (path === '/api/input') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      inputClients.add(res);
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 20000);
      req.on('close', () => { clearInterval(ping); inputClients.delete(res); });
      return;
    }

    // GPIO watcher posts here. Loopback only — this is a physical input, and
    // nothing on the venue's wifi should be able to press the booth's buttons.
    if (path === '/api/gpio' && req.method === 'POST') {
      const remote = req.socket.remoteAddress || '';
      if (!/^(::1|::ffff:127\.|127\.)/.test(remote)) return json(res, 403, { error: 'loopback only' });
      const ev = JSON.parse(await readBody(req));
      broadcastInput(ev);
      console.log('[gpio]', ev.action, ev.pin ?? '');
      return json(res, 200, { ok: true, clients: inputClients.size });
    }

    /* ---- static UI */
    let p = path === '/' ? '/src/index.html' : path;
    const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
    const s = await stat(file);
    if (s.isDirectory()) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(await readFile(file));
  } catch (e) {
    if (e.code === 'ENOENT') { res.writeHead(404, { 'content-type': 'text/plain' }).end(`not found: ${path}`); return; }
    console.error('[http]', e.message);
    if (!res.headersSent) json(res, 500, { error: e.message });
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(`\n  HoloBooth kiosk service`);
  console.log(`  model    ${piModel()}`);
  console.log(`  ui       http://localhost:${PORT}/src/index.html`);
  console.log(`  data     ${DATA_DIR}`);
  console.log(`  printing ${config.printing?.enabled === false ? 'disabled' : (config.printing?.dryRun ? 'DRY RUN' : 'enabled')}\n`);
});

process.on('SIGTERM', () => process.exit(0));
