/**
 * Renders the HoloBooth Strip Collection: print masters, contact sheets,
 * palette sheets and photographed-print mockups.
 *
 *   node tools/render-strips.mjs            lead palettes, sheets + mockups
 *   node tools/render-strips.mjs --all      every palette as a 300dpi master
 *   node tools/render-strips.mjs --only y2k  one style
 *
 * Output: out/strips/{print,sheets,mockups}/
 * Placeholder photos come from src/js/frames/strips/placeholder.mjs — one
 * booth session per design, so each strip reads like a real run of shots.
 */
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allFrames } from '../src/js/frames/packs.mjs';
import { renderCard, mintCard, printSize, printKindFor } from '../src/js/frames/render.mjs';
import { setCanvasFactory } from '../src/js/frames/draw.mjs';
import { boothSession } from '../src/js/frames/strips/placeholder.mjs';
import { STYLE_ORDER, COLLECTION } from '../src/js/frames/strips/catalog.mjs';

setCanvasFactory((w, h) => createCanvas(w, h));

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'out', 'strips');
for (const d of ['print', 'sheets', 'mockups', 'web']) mkdirSync(join(OUT, d), { recursive: true });

const argv = process.argv.slice(2);
const ALL = argv.includes('--all');
const WEB = argv.includes('--web');
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;

/** What a customer / operator might have typed, per concept. */
export const SAMPLES = {
  luxe: { personal: null, event: { title: 'The Hartwell Gala', date: '2026-11-05', message: 'An evening in black & white' } },
  reel: { personal: { name: 'Weekend Roll' } },
  y2k: { personal: { name: 'Kayla' } },
  seoul: { personal: { name: 'Mina' } },
  editorial: { personal: { name: 'Ava' }, event: { message: 'The night everyone will talk about' } },
  instant: { personal: { name: 'Lena' } },
  chrome: { event: { title: 'Neon Summit' } },
  scrapbook: { personal: { name: 'Girls Trip' } },
  datenight: { personal: { name: 'Sam & Riley' } },
  birthday: { personal: { name: 'Maya', age: 7 } },
  keepsake: { event: { title: 'Olivia & James', date: '2026-06-20', message: 'Thank you for celebrating with us' } },
  street: { personal: { name: 'Dre' } },
};
const SEEDS = { luxe: 2, reel: 6, y2k: 1, seoul: 8, editorial: 4, instant: 3, chrome: 5, scrapbook: 11, datenight: 12, birthday: 9, keepsake: 13, street: 15 };

const sessionCache = new Map();
async function photosFor(seed) {
  if (sessionCache.has(seed)) return sessionCache.get(seed);
  const cvs = boothSession((w, h) => createCanvas(w, h), { seed, count: 5, width: 1200, height: 800 });
  const imgs = await Promise.all(cvs.map(c => loadImage(c.toBuffer('image/png'))));
  sessionCache.set(seed, imgs);
  return imgs;
}

export async function renderDesign(frame, dpi = 300) {
  const kind = printKindFor(frame);
  const { W, H } = printSize(kind, dpi);
  const c = createCanvas(W, H);
  const sid = frame.design.style;
  const sample = SAMPLES[sid] || {};
  const photos = await photosFor(SEEDS[sid] || 1);
  renderCard(c.getContext('2d'), {
    frame, frameId: frame.id, W, H, photos, photo: null,
    card: mintCard({ frame, frameId: frame.id, mint: 1, forcedRarity: 'common' }),
    personalization: sample.personal ? { ...sample.personal } : null,
    event: sample.event ? { date: '2026-11-05', ...sample.event } : { date: '2026-11-05' },
  });
  return c;
}

const frames = allFrames().filter(f => f.design && (!only || f.design.style === only));
const leads = frames.filter(f => !f.paletteVariant);

/* ---------------------------------------------------------- masters */
const masters = {};
for (const f of (ALL ? frames : leads)) {
  const c = await renderDesign(f, 300);
  writeFileSync(join(OUT, 'print', `${f.id}.png`), c.toBuffer('image/png'));
  masters[f.id] = c;
  process.stdout.write(`  ✓ ${f.id.padEnd(26)} ${c.width}x${c.height}\n`);
}

/* ---------------------------------------------------------- sheets */
function sheet(list, scale, cols, label) {
  const gap = 60, top = 120;
  const cw = Math.max(...list.map(c => c.width)) * scale;
  const ch = Math.max(...list.map(c => c.height)) * scale;
  const rows = Math.ceil(list.length / cols);
  const S = createCanvas(Math.round(cols * cw + (cols + 1) * gap), Math.round(top + rows * (ch + gap + 50) + gap));
  const x = S.getContext('2d');
  x.fillStyle = '#e9e7e3'; x.fillRect(0, 0, S.width, S.height);
  x.fillStyle = '#1b1b1b'; x.font = '600 44px "Avenir Next", Arial'; x.fillText(label, gap, 76);
  list.forEach((c, i) => {
    const cx = gap + (i % cols) * (cw + gap), cy = top + Math.floor(i / cols) * (ch + gap + 50);
    x.save(); x.shadowColor = 'rgba(0,0,0,.25)'; x.shadowBlur = 24; x.shadowOffsetY = 8;
    x.drawImage(c, cx, cy, c.width * scale, c.height * scale); x.restore();
    x.fillStyle = '#333'; x.font = '500 19px "Avenir Next", Arial';
    x.fillText(c._label || '', cx, cy + c.height * scale + 34);
  });
  return S;
}

const STRIP_SCALE = 0.5;
if (!only || leads.length > 1) {
  const sig = leads.filter(f => !f.jumbo).map(f => Object.assign(masters[f.id], { _label: `${f.collectorNumber} · ${f.name} · ${f.paletteName}` }));
  if (sig.length) writeFileSync(join(OUT, 'sheets', 'signature.png'), sheet(sig, STRIP_SCALE, 6, 'HoloBooth Signature Strips — 2×6').toBuffer('image/png'));
  const jb = leads.filter(f => f.jumbo).map(f => Object.assign(masters[f.id], { _label: `${f.collectorNumber} · ${f.name} · ${f.design.shots} photos` }));
  if (jb.length) writeFileSync(join(OUT, 'sheets', 'jumbo.png'), sheet(jb, 0.42, 4, 'HoloBooth Jumbo Strips — 4×6').toBuffer('image/png'));
}

/* palette sheets: every colourway of each style, small */
for (const style of STYLE_ORDER) {
  if (only && style.id !== only) continue;
  for (const fmt of ['strip', 'jumbo']) {
    const fs = frames.filter(f => f.design.style === style.id && (fmt === 'jumbo') === !!f.jumbo);
    if (!fs.length || !COLLECTION[fmt][style.id]) continue;
    const list = [];
    for (const f of fs) {
      const c = masters[f.id] || await renderDesign(f, 150);
      c._label = f.paletteName;
      list.push(c);
    }
    const sc = list[0].width > 700 ? (fmt === 'jumbo' ? 0.3 : 0.5) : (fmt === 'jumbo' ? 0.6 : 1);
    writeFileSync(join(OUT, 'sheets', `palettes-${fmt}-${style.id}.png`), sheet(list, sc, list.length, `${style.letter} · ${style.name} — colourways (${fmt === 'jumbo' ? '4×6' : '2×6'})`).toBuffer('image/png'));
  }
}

/* ---------------------------------------------------------- mockups */
/**
 * A front-facing "photographed print": the strip on a tabletop with a soft
 * contact shadow, a hint of paper sheen and a slight turn. Not a substitute
 * for a real test print — it shows scale and finish, not colour accuracy.
 */
function mockup(master, { rot = -0.03, surface = 'linen', label = '', w = 1600, h = 1200, scale = 0.42 } = {}) {
  const M = createCanvas(w, h), x = M.getContext('2d');
  const surf = {
    linen: ['#e8e2d8', '#d6cec1'], walnut: ['#5a3f2c', '#3b281b'], marble: ['#f2f1ee', '#d9d7d2'], slate: ['#3a3d42', '#24262a'],
  }[surface];
  const g = x.createRadialGradient(w * 0.45, h * 0.35, 50, w / 2, h / 2, w * 0.8);
  g.addColorStop(0, surf[0]); g.addColorStop(1, surf[1]);
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  if (surface === 'walnut') { x.globalAlpha = 0.12; for (let i = 0; i < 90; i++) { x.strokeStyle = i % 2 ? '#000' : '#a77b55'; x.lineWidth = 1 + (i % 5); x.beginPath(); x.moveTo(0, i * 14 + Math.sin(i) * 9); x.bezierCurveTo(w * 0.3, i * 14 + 18, w * 0.6, i * 14 - 14, w, i * 14 + 6); x.stroke(); } x.globalAlpha = 1; }
  const dw = master.width * scale, dh = master.height * scale;
  x.save();
  x.translate(w / 2, h / 2); x.rotate(rot);
  x.shadowColor = 'rgba(0,0,0,.38)'; x.shadowBlur = 40; x.shadowOffsetX = 10; x.shadowOffsetY = 18;
  x.fillStyle = '#fff'; x.fillRect(-dw / 2, -dh / 2, dw, dh);
  x.shadowColor = 'transparent';
  x.drawImage(master, -dw / 2, -dh / 2, dw, dh);
  // glossy sheen: a broad diagonal highlight
  const sh = x.createLinearGradient(-dw / 2, -dh / 2, dw / 2, dh / 2);
  sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(0.42, 'rgba(255,255,255,.10)'); sh.addColorStop(0.5, 'rgba(255,255,255,.02)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = sh; x.fillRect(-dw / 2, -dh / 2, dw, dh);
  x.restore();
  if (label) { x.fillStyle = surface === 'walnut' || surface === 'slate' ? 'rgba(255,255,255,.75)' : 'rgba(0,0,0,.6)'; x.font = '500 26px "Avenir Next", Arial'; x.fillText(label, 40, h - 40); }
  return M;
}

const SURF = ['linen', 'marble', 'walnut', 'slate'];
let k = 0;
for (const f of leads) {
  const c = masters[f.id];
  const isJ = f.jumbo;
  const m = mockup(c, { rot: (k % 2 ? 1 : -1) * (0.02 + (k % 3) * 0.012), surface: SURF[k % SURF.length], w: isJ ? 1400 : 1000, h: isJ ? 1600 : 1500, scale: isJ ? 0.85 : 0.68 });
  writeFileSync(join(OUT, 'mockups', `${f.id}.jpg`), m.toBuffer('image/jpeg', 88));
  k++;
}

/* a pair shot: one 2x6 next to its jumbo sibling, for the scale story */
if (!only) {
  const pairs = [['sd-keepsake-botanical', 'jb-keepsake-botanical'], ['sd-reel-gold', 'jb-reel-gold'], ['sd-seoul-milk', 'jb-seoul-milk']];
  for (const [a, b] of pairs) {
    if (!masters[a] || !masters[b]) continue;
    const w = 2000, h = 1500, M = createCanvas(w, h), x = M.getContext('2d');
    const g = x.createRadialGradient(w * 0.4, h * 0.3, 50, w / 2, h / 2, w * 0.8);
    g.addColorStop(0, '#efebe4'); g.addColorStop(1, '#d9d2c6'); x.fillStyle = g; x.fillRect(0, 0, w, h);
    const sc = 0.62;
    [[masters[a], 560, -0.025], [masters[b], 1260, 0.02]].forEach(([c, cx, r]) => {
      const dw = c.width * sc, dh = c.height * sc;
      x.save(); x.translate(cx, h / 2 + 10); x.rotate(r);
      x.shadowColor = 'rgba(0,0,0,.35)'; x.shadowBlur = 36; x.shadowOffsetX = 8; x.shadowOffsetY = 16;
      x.fillStyle = '#fff'; x.fillRect(-dw / 2, -dh / 2, dw, dh); x.shadowColor = 'transparent';
      x.drawImage(c, -dw / 2, -dh / 2, dw, dh); x.restore();
    });
    writeFileSync(join(OUT, 'mockups', `pair-${a.split('-')[1]}.jpg`), M.toBuffer('image/jpeg', 88));
  }
}

/* web previews: every colourway at screen size, plus the mockups as-is */
if (WEB) {
  for (const f of frames) {
    const c = await renderDesign(f, 130);
    writeFileSync(join(OUT, 'web', `${f.id}.jpg`), c.toBuffer('image/jpeg', 86));
  }
  console.log(`  ✓ ${frames.length} web previews`);
}

console.log(`\n${Object.keys(masters).length} masters → ${OUT}`);
