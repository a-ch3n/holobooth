/**
 * Headless end-to-end check of everything that doesn't need a screen:
 * rarity rolls, minting, card + strip rendering, and GIF encoding.
 *
 * The GIF encoder is browser code, so we shim just enough DOM (createElement
 * ->  node-canvas, FileReader not needed) to run the real module rather than a
 * copy of it — a test against a copy proves nothing.
 */
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drawFakePhoto } from './fixtures.mjs';
import { setCanvasFactory } from '../src/js/frames/draw.mjs';
import { mintCard, renderCard, renderStrip, printSize, printKindFor } from '../src/js/frames/render.mjs';
import { STYLE_ORDER, COLLECTION, FORMATS } from '../src/js/frames/strips/catalog.mjs';
import { boothSession } from '../src/js/frames/strips/placeholder.mjs';
import { readFileSync } from 'node:fs';
import { rollPack, rollRarity, seededRng } from '../src/js/frames/rarity.mjs';
import { allFrames, RARITY_ORDER, PACKS, SET, ENERGY_IDS, frameById } from '../src/js/frames/packs.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out', 'session');
mkdirSync(out, { recursive: true });
setCanvasFactory((w, h) => createCanvas(w, h));

// minimal DOM shim so the real gif.js runs unmodified
globalThis.document = { createElement: t => (t === 'canvas' ? createCanvas(1, 1) : {}) };
globalThis.Blob = class Blob {
  constructor(parts) { this._b = Buffer.concat(parts.map(p => Buffer.from(p))); }
  get size() { return this._b.length; }
  buffer() { return this._b; }
};
const { encodeGif } = await import('../src/js/gif.js');

let fails = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) fails++;
};

/* ---------------------------------------------------- 1. rarity odds */
console.log('\nrarity distribution (100k rolls, base odds)');
{
  const rng = seededRng(99);
  const counts = {};
  for (let i = 0; i < 100000; i++) { const r = rollRarity({ rng }); counts[r] = (counts[r] || 0) + 1; }
  for (const r of RARITY_ORDER) console.log(`    ${r.padEnd(9)} ${(counts[r] / 1000).toFixed(2)}%`);
  ok('common is the most frequent tier', counts.common > counts.uncommon);
  ok('secret rares stay under 2%', counts.secret / 100000 < 0.02);

  const boosted = {};
  const rng2 = seededRng(1234);
  for (let i = 0; i < 100000; i++) { const r = rollRarity({ boost: 1.6, rng: rng2 }); boosted[r] = (boosted[r] || 0) + 1; }
  ok('booster boost raises rare+ odds', (boosted.rare + boosted.ultra + boosted.secret) > (counts.rare + counts.ultra + counts.secret),
     `${(((boosted.rare + boosted.ultra + boosted.secret) / 1000)).toFixed(1)}% vs ${(((counts.rare + counts.ultra + counts.secret) / 1000)).toFixed(1)}%`);
}

/* ------------------------------------------------- 2. pack guarantee */
{
  let violations = 0;
  for (let i = 0; i < 5000; i++) {
    const pack = rollPack(3, { boost: 1.6, guarantee: 'rare', rng: seededRng(i) });
    if (!pack.some(r => RARITY_ORDER.indexOf(r) >= RARITY_ORDER.indexOf('rare'))) violations++;
  }
  ok('booster pack guarantee always honoured', violations === 0, `${violations} violations / 5000`);
}

/* ---------------------------------------------- 3. deterministic mint */
{
  const a = mintCard({ frameId: 'pp-emberling', mint: 77 });
  const b = mintCard({ frameId: 'pp-emberling', mint: 77 });
  ok('same frame+mint reproduces the same card', a.rarity === b.rarity && a.serial === b.serial, a.serial);
  const c = mintCard({ frameId: 'pp-boothra-fullart', mint: 501 });
  ok('mint past the limit flags sold out', c.soldOut === true, `${c.serial}`);
}

/* ------------------------------------------------ 3b. set integrity */
{
  const fs = allFrames();
  // strip-collection designs carry their own numbering (SIG A, JUMBO A…)
  const nums = fs.filter(f => !f.promo && !f.design).map(f => f.setNumber);
  ok('collector numbers are unique', new Set(nums).size === nums.length);
  const secrets = fs.filter(f => f.secret);
  ok('secret rares are numbered above the set size',
     secrets.length > 0 && secrets.every(f => f.setNumber > SET.size), `${secrets.length} secrets, set of ${SET.size}`);
  const typed = new Set(fs.map(f => f.energyType));
  ok('every energy type appears in the set', typed.size === ENERGY_IDS.length, `${typed.size}/${ENERGY_IDS.length}`);
  // Attacks and the weakness footer belong to the battle-style layouts. Cutie
  // cards deliberately carry chips and a caption instead, so scope the check
  // to the templates that actually render those rows.
  const BATTLE = new Set(['creature', 'creatureMax', 'creatureFullArt', 'party']);
  const battle = fs.filter(f => BATTLE.has(f.template));
  ok('every battle-style card has at least one attack',
     battle.every(f => (f.content.attacks || []).length > 0), `${battle.length} cards`);
  ok('every battle-style card has a weakness type',
     battle.every(f => !!f.content.footer.weakness));
  const cutie = fs.filter(f => f.template === 'kawaii');
  ok('every cutie card has stat chips and a caption',
     cutie.length > 0 && cutie.every(f => (f.content.chips || []).length && f.content.caption),
     `${cutie.length} cards`);
  ok('MAX cards hit harder than their base card', ['emberling', 'zaplet', 'dracolet'].every(k => {
    const base = frameById(`pp-${k}`), max = frameById(`pp-${k}-max`);
    return max.hp > base.hp && max.content.attacks[0].dmg > base.content.attacks[0].dmg;
  }));
  console.log(`    set: ${SET.name} — ${SET.total} cards across ${PACKS.length} classes`);
}

/* -------------------------------------------- 4. every frame renders */
{
  const photo = await (async () => {
    const c = createCanvas(1600, 1600); drawFakePhoto(c.getContext('2d'), 1600, 1600, 1);
    return loadImage(c.toBuffer('image/png'));
  })();
  const { W, H } = printSize('card', 300);
  let rendered = 0;
  for (const f of allFrames()) {
    const cv = createCanvas(W, H);
    try {
      renderCard(cv.getContext('2d'), { frameId: f.id, W, H, photo, card: mintCard({ frameId: f.id, mint: 5 }) });
      const d = cv.getContext('2d').getImageData(W >> 1, H >> 1, 1, 1).data;
      if (d[3] > 0) rendered++;
    } catch (e) { console.log(`      ${f.id}: ${e.message}`); }
  }
  ok('all frames render at 300dpi print size', rendered === allFrames().length, `${rendered}/${allFrames().length}`);

  // one full session's worth of output, saved for eyeballing
  const card = mintCard({ frameId: 'pp-emberling-rainbow', mint: 42, product: { rarityBoost: 1.6 } });
  const cv = createCanvas(W, H);
  renderCard(cv.getContext('2d'), { frameId: card.frameId, W, H, photo, card });
  writeFileSync(join(out, 'card-print-master.png'), cv.toBuffer('image/png'));

  const s = printSize('strip', 300);
  const sv = createCanvas(s.W, s.H);
  const shots = await Promise.all([0, 1, 2, 3].map(async v => {
    const c = createCanvas(1600, 900); drawFakePhoto(c.getContext('2d'), 1600, 900, v);
    return loadImage(c.toBuffer('image/png'));
  }));
  renderStrip(sv.getContext('2d'), { W: s.W, H: s.H, photos: shots, card });
  writeFileSync(join(out, 'strip-print-master.png'), sv.toBuffer('image/png'));
  ok('print masters written', true, `${W}x${H} card, ${s.W}x${s.H} strip`);
}


/* -------------------------------------- 4b. the strip collection */
console.log('\nstrip collection (Signature 2x6 + Jumbo 4x6)');
{
  ok('twelve concepts, A–L', STYLE_ORDER.length === 12 && STYLE_ORDER.map(s => s.letter).join('') === 'ABCDEFGHIJKL');
  ok('every concept has at least three colourways', STYLE_ORDER.every(s => Object.keys(s.palettes).length >= 3),
     STYLE_ORDER.map(s => `${s.letter}${Object.keys(s.palettes).length}`).join(' '));
  ok('every concept is offered as a Signature and a Jumbo strip',
     STYLE_ORDER.every(s => COLLECTION.strip[s.id] && COLLECTION.jumbo[s.id]));
  const jumboShots = new Set(Object.values(COLLECTION.jumbo).map(c => c.shots));
  ok('Jumbo strips come in 3, 4 and 5 photo layouts', [3, 4, 5].every(n => jumboShots.has(n)), [...jumboShots].join('/'));

  const designs = allFrames().filter(f => f.design);
  ok('every style × colourway × format is a frame', designs.length === STYLE_ORDER.reduce((a, s) => a + Object.keys(s.palettes).length * 2, 0), `${designs.length} frames`);
  ok('Jumbo frames print as a 4x6', designs.filter(f => f.jumbo).every(f => printKindFor(f) === 'jumbo') && printSize('jumbo', 300).W === 1200 && printSize('jumbo', 300).H === 1800);
  ok('Signature frames print as a 2x6', designs.filter(f => !f.jumbo).every(f => printKindFor(f) === 'strip'));

  const cfg = JSON.parse(readFileSync(join(root, 'config', 'booth.config.json'), 'utf8'));
  ok('a product sells Jumbo prints', cfg.pricing.products.some(p => p.prints?.jumbo > 0));
  ok('Jumbo prints have a sheet to go on', cfg.printing.jumboSheet?.widthIn === 6 && cfg.printing.jumboSheet?.heightIn === 4);

  const shots = await Promise.all(boothSession((w, h) => createCanvas(w, h), { seed: 3, count: 5, width: 900, height: 600 })
    .map(c => loadImage(c.toBuffer('image/png'))));
  const logo = await (async () => { const c = createCanvas(400, 160); const x = c.getContext('2d'); x.fillStyle = '#123'; x.fillRect(0, 0, 400, 160); return loadImage(c.toBuffer('image/png')); })();
  const TEXTS = [
    { label: 'blank', personal: null, event: null, logo: null },
    { label: 'named', personal: { name: 'Maya', age: 7 }, event: { title: 'Olivia & James', date: '2026-06-20', message: 'Thank you for celebrating with us' }, logo },
    { label: 'long', personal: { name: 'Bartholomew-Alexandria Q.' }, event: { title: 'The Very Long Annual Winter Charity Gala', message: 'A message that is much too long to fit on one line of any strip at all, really' }, logo },
  ];
  let renders = 0, bad = [];
  for (const style of STYLE_ORDER) {
    for (const format of ['strip', 'jumbo']) {
      const palettes = Object.keys(style.palettes);
      for (const shotsN of FORMATS[format].shots) {
        for (const [ti, t] of TEXTS.entries()) {
          const pid = palettes[(shotsN + ti) % palettes.length];
          const frame = { ...designs.find(f => f.design.style === style.id && f.design.palette === pid && !!f.jumbo === (format === 'jumbo')) };
          frame.design = { ...frame.design, shots: shotsN };
          const { W, H } = printSize(format, 150);
          const cv = createCanvas(W, H);
          try {
            const meta = renderCard(cv.getContext('2d'), {
              frame, frameId: frame.id, W, H, photos: shots, card: mintCard({ frame, frameId: frame.id, mint: 3 }),
              personalization: t.personal, event: t.event, eventLogo: t.logo,
            });
            renders++;
            const slots = meta.photoSlots || [];
            const where = `${style.id}/${format}/${shotsN}/${t.label}`;
            if (slots.length !== shotsN) bad.push(`${where}: ${slots.length} photo slots`);
            for (const s of slots) {
              if (s.x < -1 || s.y < -1 || s.x + s.w > W + 1 || s.y + s.h > H + 1) bad.push(`${where}: slot off the sheet`);
              const a = s.w / s.h;
              if (a < 0.7 || a > 2.6) bad.push(`${where}: slot aspect ${a.toFixed(2)}`);
            }
            for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) {
              const A = slots[i], B = slots[j];
              const ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x), oy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
              if (ox > 2 && oy > 2) bad.push(`${where}: photos ${i} and ${j} overlap`);
            }
          } catch (e) { bad.push(`${style.id}/${format}/${shotsN}/${t.label}: ${e.message}`); }
        }
      }
    }
  }
  bad.slice(0, 12).forEach(b => console.log(`      ${b}`));
  ok('every design renders with 3/4/5 photos, blank, named and overlong text', bad.length === 0, `${renders} renders, ${bad.length} problems`);
}

/* --------------------------------------------------- 5. gif encoding */
{
  const frames = [];
  for (let i = 0; i < 8; i++) {
    const c = createCanvas(640, 360);
    drawFakePhoto(c.getContext('2d'), 640, 360, i % 4);
    const x = c.getContext('2d');
    x.fillStyle = 'rgba(255,255,255,.5)';
    x.fillRect(i * 70, 20, 60, 40);   // something that actually moves
    frames.push(c);
  }
  const blob = await encodeGif(frames, { width: 320, fps: 12, boomerang: true });
  const buf = blob.buffer();
  writeFileSync(join(out, 'boomerang.gif'), buf);
  const header = buf.subarray(0, 6).toString('latin1');
  ok('gif has a valid GIF89a header', header === 'GIF89a', header);
  ok('gif ends with the trailer byte', buf[buf.length - 1] === 0x3b);
  ok('gif is a sane size', buf.length > 4000 && buf.length < 4_000_000, `${(buf.length / 1024).toFixed(0)} KB`);
  const frameCount = countBytes(buf, [0x21, 0xf9, 0x04]);
  ok('boomerang produced 2n-2 frames', frameCount === 14, `${frameCount} frames`);
}

function countBytes(buf, seq) {
  let n = 0;
  for (let i = 0; i <= buf.length - seq.length; i++) {
    let hit = true;
    for (let k = 0; k < seq.length; k++) if (buf[i + k] !== seq[k]) { hit = false; break; }
    if (hit) n++;
  }
  return n;
}

console.log(fails ? `\n${fails} check(s) FAILED\n` : '\nAll checks passed.\n');
process.exit(fails ? 1 : 0);
