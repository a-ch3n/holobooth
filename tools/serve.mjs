/**
 * Zero-dependency static server for the kiosk UI, so you can run the whole
 * flow in a browser while Electron is being sorted out.
 *
 *   npm run web    →  http://127.0.0.1:5173/src/index.html
 *
 * app.js detects the missing Electron bridge and stubs it (in-memory ledgers,
 * no printing), so the picker, payment mock, capture, rarity roll and card
 * render all work against your laptop's webcam.
 *
 * Serves from the project root because index.html fetches ../config/booth.config.json.
 * The .mjs mime type matters: browsers refuse a module served as octet-stream.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 5173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/src/index.html';
  // Contain every request inside the project root.
  const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }

  try {
    const s = await stat(file);
    if (s.isDirectory()) { res.writeHead(404).end('not found'); return; }
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end(`not found: ${p}`);
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`\n  HoloBooth (browser preview)`);
  console.log(`  → http://127.0.0.1:${PORT}/src/index.html\n`);
  console.log(`  Camera: your laptop webcam. Payments: mock. Printing: disabled.`);
  console.log(`  Press "d" before paying to simulate a decline, Esc to abandon.\n`);
});
