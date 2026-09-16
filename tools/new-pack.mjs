/**
 * Scaffold an empty asset pack, with a manifest wired to placeholder art you
 * replace file-for-file.
 *
 *   node tools/new-pack.mjs my-licensed-set
 *
 * Hand packs/<id>/SPEC.md to whoever is producing the artwork — it says exactly
 * what files to deliver and at what size.
 */
import { createCanvas } from '@napi-rs/canvas';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setCanvasFactory, roundRect, font } from '../src/js/frames/draw.mjs';
import { printSize } from '../src/js/frames/render.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
setCanvasFactory((w, h) => createCanvas(w, h));

const id = (process.argv[2] || '').trim();
if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
  console.error('usage: node tools/new-pack.mjs <pack-id>   (lowercase, dashes)');
  process.exit(1);
}
const dir = join(root, 'packs', id);
if (existsSync(dir)) { console.error(`packs/${id} already exists`); process.exit(1); }

const W = 1500, H = 2100;
const WIN = { x: 0.09, y: 0.15, w: 0.82, h: 0.40 };

for (const d of ['frames', 'symbols', 'characters', 'fonts']) await mkdir(join(dir, d), { recursive: true });

/* placeholder frame art, with the window correctly knocked out */
const c = createCanvas(W, H);
const x = c.getContext('2d');
roundRect(x, 0, 0, W, H, W * 0.048);
x.fillStyle = '#d8d3c6'; x.fill();
x.fillStyle = '#fdfcf8';
roundRect(x, W * 0.05, W * 0.05, W - W * 0.1, H - W * 0.1, W * 0.022); x.fill();
x.fillStyle = '#9c9484';
x.font = font(700, W * 0.030, 'sans-serif');
x.textAlign = 'center';
x.fillText('REPLACE frames/base.png', W / 2, H * 0.10);
x.font = font(500, W * 0.020, 'sans-serif');
x.fillText(`${W}x${H}, window knocked out`, W / 2, H * 0.125);
x.save();
x.globalCompositeOperation = 'destination-out';
roundRect(x, W * WIN.x, H * WIN.y, W * WIN.w, H * WIN.h, W * 0.008);
x.fill();
x.restore();
await writeFile(join(dir, 'frames', 'base.png'), c.toBuffer('image/png'));

const manifest = {
  schema: 1, id, name: id.replace(/-/g, ' ').replace(/\b\w/g, s => s.toUpperCase()),
  version: '0.1.0',
  licensor: { name: 'REPLACE — licensor legal name', agreement: 'REPLACE — agreement reference', contact: '' },
  attribution: 'REPLACE — the exact line your licence requires',
  attributionPosition: { x: 0.5, y: 0.972, size: 0.0155, align: 'center', color: '#444', opacity: 0.85 },
  approvalRequired: true,
  background: '#ffffff', corner: 0.048,
  defaultFont: 'system-ui, sans-serif',
  fonts: [], symbols: {},
  frames: [{
    id: 'base', name: 'Base Frame', art: 'frames/base.png',
    energyType: 'plain', hp: 100, aspect: [2.5, 3.5],
    photoWindow: { ...WIN, corner: 0.006 },
    photoFocal: { x: 0.5, y: 0.38 },
    collectorNumber: '01',
    symbolSlots: [],
    text: [
      { id: 'name', value: '{{name}}', x: 0.10, y: 0.128, w: 0.6, size: 0.052, weight: 800, color: '#1c1c1c' },
      { id: 'hp', value: '{{hp}} HP', x: 0.90, y: 0.126, w: 0.2, size: 0.040, weight: 900, color: '#a01c1c', align: 'right' },
      { id: 'num', value: '{{collectorNumber}}', x: 0.10, y: 0.88, w: 0.3, size: 0.024, weight: 700, color: '#555' },
    ],
  }],
};
await writeFile(join(dir, 'pack.json'), JSON.stringify(manifest, null, 2));

const { W: pw, H: ph } = printSize('card', 300);
await writeFile(join(dir, 'SPEC.md'), `# ${manifest.name} — asset specification

Give this file to whoever produces the artwork.

## Frame art — \`frames/*.png\`

* **${W} x ${H} px** PNG with alpha. (The print master is ${pw}x${ph} at 300dpi;
  authoring at 2x leaves headroom for the oversized photo-prop board.)
* Aspect **2.5 : 3.5**, matching a standard trading card.
* **The photo window must be fully transparent.** Everything else opaque.
  Current window, as fractions of the card: x ${WIN.x}, y ${WIN.y}, w ${WIN.w}, h ${WIN.h}.
  If the artwork puts the window somewhere else, change \`photoWindow\` in
  pack.json to match — the validator checks that the two agree.
* No live text baked into the art. Names, HP and numbers are drawn by the booth
  so they can be personalised; the art supplies the plates they sit on.
* Bleed: the card is trimmed at the artboard edge. Keep anything that must
  survive trimming at least 0.08 in (36 px at this size) inside the edge.

## Symbols — \`symbols/*.png\`
256x256 PNG with alpha, one per type or icon. List them under \`symbols\` in pack.json.

## Characters — \`characters/*.png\`
Transparent PNG, ~1000 px on the long edge.

## Fonts — \`fonts/*.woff2\`
Only fonts your licence covers for embedding. Declare each under \`fonts\`.

## Paperwork
Put the actual licence in \`LICENSE.txt\` and fill in \`licensor\` and
\`attribution\` in pack.json. The attribution line prints on every card.

## Check it
\`\`\`
node tools/validate-pack.mjs packs/${id}
node tools/render-pack.mjs packs/${id} --approval
\`\`\`
`);
await writeFile(join(dir, 'LICENSE.txt'),
  'REPLACE THIS FILE with the licence or written permission covering this pack.\n');

console.log(`\ncreated packs/${id}/`);
console.log(`  next: node tools/validate-pack.mjs packs/${id}\n`);
