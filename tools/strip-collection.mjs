/**
 * strip-collection.mjs — renders the HoloBooth Photo Strip Collection.
 *
 *   npm run strips            → out/strip-collection/
 *
 * print/      every design × colour, print-ready at native DS40 size, photo
 *             boxes blank: 620x1844 (2x6 strip) and 1240x1844 (4x6 Jumbo)
 * pages/      what goes to the printer: the native 1844x1240 page (toPrinterNative)
 * mockups/    front-facing mockups of the physical prints
 * index.html  the lookbook
 */
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FONT_FILES } from '../src/js/frames/fonts.mjs';
import { styledStrip, collectionFrames, STYLES, JUMBO_STYLES, FORMATS, COLLECTION_NAME } from '../src/js/frames/strips.mjs';
import { buildPersonal } from '../src/js/frames/render.mjs';
import { toPrinterNative, printRotations } from '../src/js/layout.mjs';
const toNative = (type, canvas) => toPrinterNative({ type, canvas }, printRotations({}), (w, h) => createCanvas(w, h));

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.OUT || join(ROOT, 'out', 'strip-collection');
for (const d of ['print', 'pages', 'mockups']) mkdirSync(join(OUT, d), { recursive: true });
for (const f of FONT_FILES) GlobalFonts.registerFromPath(join(ROOT, 'src', 'fonts', f.file), f.family);

/** Sample text for the designs that are personalised, so the book shows them filled in. */
const SAMPLE = {
  fourcut: { name: '' },
  loveletter: { name: 'Alex & Sam' },
  partypop: { name: 'Mia', age: 25 },
  keepsake: { name: 'Sarah & James' },
};
const EVENT = { date: '2026-06-14' };

export function render(frame, { scale = 1 } = {}) {
  const f = FORMATS[frame.format];
  const c = createCanvas(Math.round(f.W * scale), Math.round(f.H * scale));
  const ctx = c.getContext('2d');
  const meta = { personal: buildPersonal(SAMPLE[frame.style] || {}), event: EVENT, mintedAt: '2026-06-14T20:00:00' };
  styledStrip(ctx, { W: c.width, H: c.height, frame, photos: [], meta });
  return { canvas: c, meta };
}

const frames = collectionFrames();
const only = process.argv[2];
const list = only ? frames.filter(f => f.id.includes(only)) : frames;
const t0 = Date.now();
for (const fr of list) {
  const { canvas } = render(fr);
  writeFileSync(join(OUT, 'print', `${fr.id}.png`), canvas.toBuffer('image/png'));
  if (fr.format === 'jumbo') writeFileSync(join(OUT, 'pages', `${fr.id}-page.png`), toNative('4x6', canvas).toBuffer('image/png'));
  if (fr.format === 'strip') {
    const page = toNative('strip', canvas);
    writeFileSync(join(OUT, 'pages', `${fr.id}-page.png`), page.toBuffer('image/png'));
  }
}
console.log(`${list.length} designs rendered in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${OUT}`);

/* ------------------------------------------------------------- mockups */

const renders = new Map(frames.map(fr => [fr.id, render(fr).canvas]));
const jpeg = (c, name, q = 88) => writeFileSync(join(OUT, 'mockups', name), c.toBuffer('image/jpeg', q));

/** A seamless studio surface: soft light from above, a little paper grain. */
function surface(W, H, tone = 'light') {
  const c = createCanvas(W, H);
  const x = c.getContext('2d');
  const g = x.createRadialGradient(W / 2, H * 0.32, 0, W / 2, H * 0.4, Math.max(W, H) * 0.75);
  if (tone === 'dark') { g.addColorStop(0, '#3a3a40'); g.addColorStop(1, '#141418'); }
  else { g.addColorStop(0, '#f6f3ee'); g.addColorStop(1, '#d3ccc2'); }
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < W * H / 220; i++) {
    x.fillStyle = r() > 0.5 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.04)';
    x.fillRect(r() * W, r() * H, 1.5, 1.5);
  }
  return { c, x };
}

/** One physical print, front-on: paper, a soft contact shadow, a faint gloss. */
function print(x, img, cx, cy, h, angle = 0) {
  const w = h * img.width / img.height;
  x.save();
  x.translate(cx, cy);
  x.rotate(angle * Math.PI / 180);
  x.shadowColor = 'rgba(30,20,10,.32)'; x.shadowBlur = h * 0.045; x.shadowOffsetY = h * 0.018;
  x.fillStyle = '#ffffff'; x.fillRect(-w / 2, -h / 2, w, h);
  x.shadowColor = 'transparent';
  x.drawImage(img, -w / 2, -h / 2, w, h);
  const gl = x.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
  gl.addColorStop(0, 'rgba(255,255,255,0)'); gl.addColorStop(0.42, 'rgba(255,255,255,.10)');
  gl.addColorStop(0.5, 'rgba(255,255,255,.02)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gl; x.fillRect(-w / 2, -h / 2, w, h);
  x.strokeStyle = 'rgba(0,0,0,.10)'; x.lineWidth = 1; x.strokeRect(-w / 2 + 0.5, -h / 2 + 0.5, w - 1, h - 1);
  x.restore();
}

// Each design: its colour variants side by side.
for (const st of [...STYLES, ...JUMBO_STYLES]) {
  const jumbo = JUMBO_STYLES.includes(st);
  const ids = st.variants.map(v => `${jumbo ? 'jumbo' : 'sc'}-${st.id}-${v.id}`);
  const h = jumbo ? 1180 : 1240, n = ids.length;
  const w = h * (jumbo ? 1240 : 620) / 1844, gap = jumbo ? 120 : 140;
  // One width for every 2x6 mockup so they line up in a grid.
  const W = jumbo ? Math.round(n * w + (n - 1) * gap + 360) : 1900, H = 1600;
  const { c, x } = surface(W, H);
  const tilts = n === 1 ? [0] : n === 2 ? [-1.5, 1.8] : [-2.2, 0.6, 2.4];
  ids.forEach((id, i) => print(x, renders.get(id), W / 2 + (i - (n - 1) / 2) * (w + gap), H / 2 + (i % 2 ? 14 : -10), h, tilts[i]));
  jpeg(c, `${st.id}.jpg`);
}

// The collection: one of each of the twelve.
{
  const W = 3600, H = 1700;
  const { c, x } = surface(W, H, 'dark');
  const h = 1180, w = h * 620 / 1844, step = (W - 300 - w) / 11;
  STYLES.forEach((st, i) => print(x, renders.get(`sc-${st.id}-${st.variants[0].id}`), 150 + w / 2 + i * step, H / 2 + (i % 2 ? 26 : -26), h, (i % 3 - 1) * 2.2));
  jpeg(c, 'collection.jpg', 90);
}

// Jumbo next to a classic 2x6, to scale (both 6.15 in tall).
{
  const W = 2000, H = 1600;
  const { c, x } = surface(W, H);
  const h = 1200;
  print(x, renders.get('sc-atelier-ivory'), W / 2 - 520, H / 2, h, -1.2);
  print(x, renders.get('jumbo-gallery-ivory'), W / 2 + 200, H / 2, h, 1.2);
  jpeg(c, 'jumbo-vs-classic.jpg');
}

// A DS40 sheet straight out of the printer: two strips, before the cut.
{
  const W = 1800, H = 1600;
  const { c, x } = surface(W, H);
  const page = toNative('strip', renders.get('sc-keepsake-sage'));
  print(x, page, W / 2, H / 2, 1240, 0);
  jpeg(c, 'ds40-sheet.jpg');
}

// Small previews of every print file, for the lookbook.
mkdirSync(join(OUT, 'preview'), { recursive: true });
for (const [id, cv] of renders) writeFileSync(join(OUT, 'preview', `${id}.jpg`), cv.toBuffer('image/jpeg', 86));
console.log(`mockups → ${join(OUT, 'mockups')}`);

export { frames, OUT, STYLES, JUMBO_STYLES, COLLECTION_NAME };
