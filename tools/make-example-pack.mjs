/**
 * Generates a complete, working asset pack from original art.
 *
 * The point is not the artwork — it is that the pipeline is provably real. Run
 * this, look at packs/example-studio/, and you have a template to hand your
 * licensor or your illustrator: "produce files shaped like these."
 *
 *   node tools/make-example-pack.mjs
 */
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setCanvasFactory, roundRect, linGrad, shade, alpha, grain, font } from '../src/js/frames/draw.mjs';
import { energyPip, ENERGY } from '../src/js/frames/energy.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACK = join(root, 'packs', 'example-studio');
setCanvasFactory((w, h) => createCanvas(w, h));

for (const d of ['frames', 'symbols', 'characters']) mkdirSync(join(PACK, d), { recursive: true });

/* Authoring size. Pack art should be at least the print master (750x1050 at
   300dpi); 2x that gives headroom for a bigger card or a prop board. */
const W = 1500, H = 2100;

/* The photo window, in fractions — the manifest and the artwork must agree,
   which is exactly the thing a validator should check for you. */
const WIN = { x: 0.088, y: 0.150, w: 0.824, h: 0.404 };

const COLORWAYS = [
  { id: 'crimson', name: 'Crimson Frame', type: 'ember' },
  { id: 'azure',   name: 'Azure Frame',   type: 'wave' },
  { id: 'verdant', name: 'Verdant Frame', type: 'leaf' },
];

function drawFrameArt(id, typeId) {
  const e = ENERGY[typeId];
  const c = createCanvas(W, H);
  const x = c.getContext('2d');

  /* outer border */
  x.save();
  roundRect(x, 0, 0, W, H, W * 0.048);
  x.clip();
  x.fillStyle = linGrad(x, 0, 0, W * 0.7, H, [
    [0, shade(e.light, 0.18)], [0.35, e.base], [0.72, shade(e.base, -0.12)], [1, shade(e.light, 0.02)],
  ]);
  x.fillRect(0, 0, W, H);
  grain(x, 0, 0, W, H, 0.04, 9);
  x.restore();

  /* inner face */
  const m = W * 0.052;
  x.save();
  roundRect(x, m, m, W - m * 2, H - m * 2, W * 0.022);
  x.fillStyle = '#fffdf7';
  x.fill();
  x.strokeStyle = alpha(e.dark, 0.5);
  x.lineWidth = W * 0.004;
  x.stroke();
  x.restore();

  /* nameplate strip behind the name/HP row */
  x.save();
  x.fillStyle = alpha(e.light, 0.45);
  roundRect(x, m + W * 0.018, H * 0.088, W - (m + W * 0.018) * 2, H * 0.050, W * 0.012);
  x.fill();
  x.restore();

  /* metallic ring around the photo window */
  const wx = W * WIN.x, wy = H * WIN.y, ww = W * WIN.w, wh = H * WIN.h;
  const ring = W * 0.011;
  x.save();
  x.strokeStyle = linGrad(x, wx, wy, wx + ww, wy + wh,
    [[0, '#fff3c4'], [0.35, '#c9992a'], [0.65, '#ffeeb0'], [1, '#a97f18']]);
  x.lineWidth = ring * 2;
  roundRect(x, wx - ring, wy - ring, ww + ring * 2, wh + ring * 2, W * 0.012);
  x.stroke();
  x.restore();

  /* attack dividers and footer rule */
  x.save();
  x.strokeStyle = alpha(e.dark, 0.22);
  x.lineWidth = Math.max(1, W * 0.0016);
  [0.635, 0.735].forEach(fy => {
    x.beginPath();
    x.moveTo(W * 0.12, H * fy); x.lineTo(W * 0.88, H * fy); x.stroke();
  });
  x.restore();

  /* footer band */
  x.save();
  x.fillStyle = alpha(e.base, 0.16);
  roundRect(x, m + W * 0.018, H * 0.845, W - (m + W * 0.018) * 2, H * 0.045, W * 0.010);
  x.fill();
  x.restore();

  /* Punch the photo window transparent — this is the whole contract between
     frame art and the compositor. */
  x.save();
  x.globalCompositeOperation = 'destination-out';
  roundRect(x, wx, wy, ww, wh, W * 0.006);
  x.fill();
  x.restore();

  writeFileSync(join(PACK, 'frames', `${id}.png`), c.toBuffer('image/png'));
  return c;
}

function drawSymbol(typeId) {
  const S = 256;
  const c = createCanvas(S, S);
  energyPip(c.getContext('2d'), typeId, S / 2, S / 2, S / 2 - 6);
  writeFileSync(join(PACK, 'symbols', `${typeId}.png`), c.toBuffer('image/png'));
}

for (const cw of COLORWAYS) drawFrameArt(cw.id, cw.type);
for (const t of ['ember', 'wave', 'leaf', 'plain']) drawSymbol(t);

/* ------------------------------------------------------------ manifest */

const manifest = {
  schema: 1,
  id: 'example-studio',
  name: 'Example Studio Pack',
  version: '1.0.0',
  licensor: {
    name: 'HoloBooth Studio (original art)',
    agreement: 'N/A — original work, included as a working template',
    contact: 'replace with your licensing contact',
  },
  attribution: '© {{year}} {{booth}} · Example Studio Pack',
  attributionPosition: { x: 0.5, y: 0.972, size: 0.0155, align: 'center', color: '#6b5a3a', opacity: 0.85 },
  approvalRequired: false,
  background: '#ffffff',
  corner: 0.048,
  defaultFont: 'Nunito, system-ui, sans-serif',
  fonts: [],
  symbols: {
    ember: 'symbols/ember.png',
    wave: 'symbols/wave.png',
    leaf: 'symbols/leaf.png',
    plain: 'symbols/plain.png',
  },
  frames: COLORWAYS.map((cw, i) => ({
    id: cw.id,
    name: cw.name,
    art: `frames/${cw.id}.png`,
    energyType: cw.type,
    hp: 120,
    aspect: [2.5, 3.5],
    photoWindow: { ...WIN, corner: 0.006 },
    photoFocal: { x: 0.5, y: 0.38 },
    collectorNumber: `EX ${String(i + 1).padStart(2, '0')}`,
    symbolSlots: [
      { id: 'type', symbol: cw.type, x: 0.905, y: 0.113, r: 0.036 },
    ],
    text: [
      { id: 'name',  value: '{{name}}',  x: 0.105, y: 0.128, w: 0.60, size: 0.052, weight: 800, color: '#2a2118' },
      { id: 'hp',    value: '{{hp}} HP', x: 0.855, y: 0.126, w: 0.20, size: 0.040, weight: 900, color: '#b0231f', align: 'right' },
      { id: 'atk1',  value: 'Snapshot',  x: 0.135, y: 0.612, w: 0.55, size: 0.040, weight: 800, color: '#2a2118' },
      { id: 'dmg1',  value: '60',        x: 0.875, y: 0.615, w: 0.16, size: 0.048, weight: 900, color: '#2a2118', align: 'right' },
      { id: 'atk2',  value: 'Say Cheese', x: 0.135, y: 0.712, w: 0.55, size: 0.040, weight: 800, color: '#2a2118' },
      { id: 'dmg2',  value: '90',        x: 0.875, y: 0.715, w: 0.16, size: 0.048, weight: 900, color: '#2a2118', align: 'right' },
      { id: 'flav',  value: '{{headline}}', x: 0.105, y: 0.775, w: 0.79, size: 0.026, weight: 400,
        color: '#5a4a33', wrap: true, lineHeight: 0.034, maxLines: 2 },
      { id: 'num',   value: '{{collectorNumber}}', x: 0.105, y: 0.879, w: 0.30, size: 0.024, weight: 700, color: '#5a4a33' },
      { id: 'ser',   value: '{{serial}}', x: 0.895, y: 0.879, w: 0.35, size: 0.024, weight: 700, color: '#5a4a33', align: 'right' },
    ],
  })),
};

writeFileSync(join(PACK, 'pack.json'), JSON.stringify(manifest, null, 2));
writeFileSync(join(PACK, 'LICENSE.txt'),
`Example Studio Pack
===================

The artwork in this pack was generated by tools/make-example-pack.mjs and is
original to this project. It exists so the asset-pack pipeline can be tested
end to end without any third-party material.

If you replace these files with licensed artwork, replace this file with your
actual grant — the licence agreement or the written permission, naming:

  * the licensor and the agreement reference
  * which properties, characters and marks are covered
  * the permitted use (retail? events only? a named event?)
  * the term and territory
  * the required attribution line, exactly as it must be printed
  * the approval process for new designs

The booth reads licensor.name and attribution from pack.json and prints the
attribution on every card. It does not and cannot verify that a licence exists;
that is on the operator.
`);

console.log(`example pack written to packs/example-studio/`);
console.log(`  frames:  ${COLORWAYS.length}   symbols: 4   authoring size: ${W}x${H}`);
