/**
 * Renders every frame in the catalogue to PNG.
 * Doubles as the visual regression check: if a template throws or a layout
 * collapses, you see it here before it reaches a printer.
 *
 *   node tools/render-all.mjs [--print] [--dpi 300]
 */
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allFrames, RARITY_ORDER, frameBox } from '../src/js/frames/packs.mjs';
import { renderCard, renderStrip, mintCard, printSize } from '../src/js/frames/render.mjs';
import { drawFakePhoto, drawFakeCharacter } from './fixtures.mjs';
import { companionCanvas, companionById, COMPANIONS } from '../src/js/frames/companions.mjs';
import { setCanvasFactory } from '../src/js/frames/draw.mjs';

setCanvasFactory((w, h) => createCanvas(w, h));

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out', 'frames');
mkdirSync(out, { recursive: true });

/* Map the design font stacks onto whatever this machine actually has, so the
   headless render is representative. On the kiosk the real webfonts load. */
const ALIASES = {
  'Cinzel': ['/usr/share/fonts/truetype/crosextra/Caladea-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'],
  'Rajdhani': ['/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'],
  'Nunito': ['/usr/share/fonts/truetype/crosextra/Carlito-Regular.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'],
  'Baloo 2': ['/usr/share/fonts/truetype/crosextra/Carlito-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'],
  'Press Start 2P': ['/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'],
};
for (const [alias, paths] of Object.entries(ALIASES)) {
  for (const p of paths) { try { if (GlobalFonts.registerFromPath(p, alias)) break; } catch {} }
}

async function makePhoto(variant, w = 1200, h = 1200) {
  const c = createCanvas(w, h);
  drawFakePhoto(c.getContext('2d'), w, h, variant);
  return loadImage(c.toBuffer('image/png'));
}
async function makeCharacter(hue) {
  const c = createCanvas(700, 700);
  drawFakeCharacter(c.getContext('2d'), 700, 700, hue);
  return loadImage(c.toBuffer('image/png'));
}

const printMode = process.argv.includes('--print');
const dpiArg = process.argv.indexOf('--dpi');
const dpi = dpiArg > -1 ? Number(process.argv[dpiArg + 1]) : 300;
const { W, H } = printMode ? printSize('card', dpi) : { W: 500, H: 700 };

const photos = await Promise.all([0, 1, 2, 3].map(v => makePhoto(v)));
const chars = {
  'pp-boothra-fullart': await makeCharacter(330),
  'pp-hallowisp-fullart': await makeCharacter(275),
};

/* Party and cutie cards are meaningless empty — render them the way a real
   session would fill them in. */
const PERSONAL_SAMPLES = [
  { name: 'Audrey', age: 6,  buddy: 'twinkle' },
  { name: 'Mateo',  age: 9,  buddy: 'flare' },
  { name: 'Priya',  age: 12, buddy: 'puddle' },
  { name: 'Jonah',  age: 4,  buddy: 'sprig' },
  { name: 'Nia',    age: 8,  buddy: 'buzz' },
  { name: 'Sam',    age: 30, buddy: 'shush' },
];
const PERSONAL_TEMPLATES = new Set(['party', 'kawaii']);
let personalIdx = 0;
const buddyImgs = {};
for (const c of COMPANIONS) {
  buddyImgs[c.id] = await loadImage(companionCanvas(c, 512, createCanvas).toBuffer('image/png'));
}

const manifest = [];
let i = 0;
for (const frame of allFrames()) {
  // Give each frame a rarity that shows off its foil, cycling through tiers.
  const rarity = RARITY_ORDER[i % RARITY_ORDER.length];
  const card = mintCard({ frameId: frame.id, mint: 12 + i * 37, forcedRarity: frame.rarityFloor || rarity });
  // Strips are 2:6, cards 2.5:3.5 — render each at its own aspect.
  const isStripFrame = frame.template === 'strip';
  const box = frameBox(frame, isStripFrame ? Math.round(H / 3) : W);
  const canvas = createCanvas(box.W, box.H);
  const ctx = canvas.getContext('2d');
  const sample = PERSONAL_TEMPLATES.has(frame.template)
    ? PERSONAL_SAMPLES[personalIdx++ % PERSONAL_SAMPLES.length]
    : null;
  try {
    renderCard(ctx, {
      frameId: frame.id, W: box.W, H: box.H,
      photo: isStripFrame ? null : photos[i % photos.length],
      photos: isStripFrame ? photos : [],
      character: chars[frame.id] || null,
      companion: sample ? buddyImgs[sample.buddy] : null,
      personalization: sample
        ? { name: sample.name, age: sample.age, companionId: sample.buddy }
        : null,
      card,
    });
  } catch (e) {
    console.error(`  ✗ ${frame.id}: ${e.message}`);
    continue;
  }
  const file = `${frame.id}.png`;
  writeFileSync(join(out, file), canvas.toBuffer('image/png'));
  manifest.push({ ...frame, theme: undefined, content: undefined, file, card });
  console.log(`  ✓ ${frame.packName.padEnd(15)} ${frame.id.padEnd(24)} ${(frame.collectorNumber||'').padEnd(8)} ${card.rarityLabel}`);
  i++;
}

/* strip */
{
  const s = printMode ? printSize('strip', dpi) : { W: 320, H: 960 };
  const canvas = createCanvas(s.W, s.H);
  renderStrip(canvas.getContext('2d'), {
    W: s.W, H: s.H, photos,
    card: mintCard({ frameId: 'pp-emberling', mint: 88 }),
  });
  writeFileSync(join(out, 'photo-strip.png'), canvas.toBuffer('image/png'));
  console.log('  ✓ photo strip');
}

/* rarity ladder on one frame, so the foil tiers can be compared side by side */
for (const r of RARITY_ORDER) {
  const canvas = createCanvas(W, H);
  renderCard(canvas.getContext('2d'), {
    frameId: 'pp-blazepup', W, H, photo: photos[1],
    card: mintCard({ frameId: 'pp-blazepup', mint: 7, forcedRarity: r }),
  });
  writeFileSync(join(out, `rarity-${r}.png`), canvas.toBuffer('image/png'));
}
console.log('  ✓ rarity ladder');

writeFileSync(join(root, 'out', 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`\n${manifest.length} frames -> ${out}  (${W}x${H}${printMode ? ` @ ${dpi}dpi` : ''})`);
