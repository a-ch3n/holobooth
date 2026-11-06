/**
 * Unit tests for the print geometry and crop maths (src/js/layout.mjs) and
 * for the strip designs' safe area. Run: npm run test:unit
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import {
  SAFE_PX, STRIP_PX, NATIVE, PRINT_ROTATIONS, CALIBRATION_DESIGN, coverCrop, coverPlacement,
  stripNativeLayout, cardSheetLayout, inside, toPrinterNative, printRotations, drawCalibration,
} from '../src/js/layout.mjs';
import { renderStrip, printSize, mintCard } from '../src/js/frames/render.mjs';
import { allFrames } from '../src/js/frames/packs.mjs';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

/* ------------------------------------------------------------ crop maths */

test('coverCrop: 16:9 camera into a portrait card window trims the sides, centred', () => {
  const r = coverCrop(1920, 1080, 600, 840);
  assert.ok(close(r.sh, 1080), 'keeps the full height');
  assert.ok(close(r.sw, 1080 * 600 / 840), 'width at the window aspect');
  assert.ok(close(r.sx, (1920 - r.sw) / 2), 'centred horizontally');
  assert.equal(r.sy, 0);
});

test('coverCrop: tall source into a wide window trims top and bottom, centred', () => {
  const r = coverCrop(1080, 1920, 1600, 900);
  assert.ok(close(r.sw, 1080));
  assert.ok(close(r.sh, 1080 * 900 / 1600));
  assert.ok(close(r.sy, (1920 - r.sh) / 2));
  assert.equal(r.sx, 0);
});

test('coverCrop never stretches: the crop always has the destination aspect', () => {
  const sources = [[1920, 1080], [1280, 720], [640, 480], [3840, 2160], [1080, 1920], [1000, 1000], [4000, 6000]];
  const dests = [[750, 1050], [532, 404], [1, 3], [3, 1], [1844, 1240], [1240, 1844], [10, 10]];
  for (const [sw0, sh0] of sources) for (const [dw, dh] of dests) {
    const r = coverCrop(sw0, sh0, dw, dh);
    assert.ok(close(r.sw / r.sh, dw / dh, 1e-9), `${sw0}x${sh0} -> ${dw}x${dh}: aspect`);
    assert.ok(close(dw / r.sw, dh / r.sh, 1e-9), 'same scale on both axes');
    assert.ok(r.sx >= 0 && r.sy >= 0 && r.sx + r.sw <= sw0 + 1e-9 && r.sy + r.sh <= sh0 + 1e-9, 'inside the source');
    assert.ok(close(r.sw, sw0) || close(r.sh, sh0), 'uses the full width or the full height (largest crop)');
  }
});

test('coverCrop: same-aspect source is used whole', () => {
  const r = coverCrop(1920, 1080, 1280, 720);
  assert.deepEqual([r.sx, r.sy, r.sw, r.sh], [0, 0, 1920, 1080]);
});

test('coverPlacement matches CSS object-fit: cover (centred)', () => {
  const p = coverPlacement(1920, 1080, 1000, 1000);
  assert.ok(close(p.h, 1000) && close(p.w, 1920 / 1080 * 1000));
  assert.ok(close(p.x, (1000 - p.w) / 2) && p.y === 0);
});

/* ------------------------------------------------------------ DS40 pages */

/* ------------------------------------------------- printer-native page */

const make = (w, h) => createCanvas(w, h);
const ROT90 = { portrait4x6: 90, strip: 90 };
const ROT270 = { portrait4x6: 270, strip: 270 };
const px = (c, x, y) => [...c.getContext('2d').getImageData(x, y, 1, 1).data.slice(0, 3)];
const RED = [255, 0, 0], BLUE = [0, 0, 255], GREEN = [0, 255, 0];

test('native page constants: 6x4 landscape, 1844 x 1240, cut at y = 620', () => {
  assert.deepEqual(NATIVE, { W: 1844, H: 1240, cutY: 620 });
  assert.deepEqual(STRIP_PX, { W: 620, H: 1844 });
  const L = stripNativeLayout();
  assert.deepEqual(L.halves, [{ x: 0, y: 0, w: 1844, h: 620 }, { x: 0, y: 620, w: 1844, h: 620 }]);
  for (const s of L.safe) assert.ok(s.y >= 20 && s.y + s.h <= 1240 - 20 && (s.y + s.h <= 600 || s.y >= 640) && s.x >= 20 && s.x + s.w <= 1824);
});

test('every job type comes out exactly 1844 x 1240', () => {
  const sizes = [
    toPrinterNative({ type: '4x6', canvas: createCanvas(1844, 1240) }, ROT90, make),
    toPrinterNative({ type: '4x6', canvas: createCanvas(1240, 1844) }, ROT90, make),
    toPrinterNative({ type: '4x6', canvas: createCanvas(1240, 1844) }, ROT270, make),
    toPrinterNative({ type: 'strip', canvas: createCanvas(620, 1844) }, ROT90, make),
    toPrinterNative({ type: 'strip', canvas: createCanvas(620, 1844) }, ROT270, make),
    toPrinterNative({ type: 'cards', canvas: createCanvas(750, 1050), count: 1 }, ROT90, make),
    toPrinterNative({ type: 'cards', canvas: createCanvas(750, 1050), count: 2 }, ROT90, make),
  ].map(c => `${c.width}x${c.height}`);
  assert.deepEqual([...new Set(sizes)], ['1844x1240']);
  assert.throws(() => toPrinterNative({ type: 'strip', canvas: createCanvas(600, 1800) }, ROT90, make), /620x1844/);
  assert.throws(() => toPrinterNative({ type: '4x6', canvas: createCanvas(1800, 1200) }, ROT90, make), /1844x1240/);
});

test('4x6: a landscape page is used as is (not rotated); a portrait page is turned', () => {
  const land = createCanvas(1844, 1240);
  assert.equal(toPrinterNative({ type: '4x6', canvas: land }, ROT90, () => { throw new Error('must not make a canvas'); }), land);
  const port = createCanvas(1240, 1844);
  const g = port.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 1240, 1844);
  g.fillStyle = '#f00'; g.fillRect(0, 0, 10, 10);           // the design's top-left corner
  const r90 = toPrinterNative({ type: '4x6', canvas: port }, ROT90, make);
  assert.deepEqual(px(r90, 1838, 5), RED, '90: design top-left → page top-right');
  const r270 = toPrinterNative({ type: '4x6', canvas: port }, ROT270, make);
  assert.deepEqual(px(r270, 5, 1235), RED, '270: design top-left → page bottom-left');
});

/** A strip with markers: red block in the middle of its top edge, blue at top-left corner, green at bottom-right. */
function markedStrip() {
  const s = createCanvas(620, 1844);
  const g = s.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 620, 1844);
  g.fillStyle = '#f00'; g.fillRect(300, 0, 20, 10);
  g.fillStyle = '#00f'; g.fillRect(0, 0, 10, 10);
  g.fillStyle = '#0f0'; g.fillRect(610, 1834, 10, 10);
  return s;
}

test('strips: two 1844 x 620 copies, one above the cut and one below, design top where expected', () => {
  for (const [rot, expect] of [
    // 90 clockwise: the strip's top edge → the right end of each half; its left edge → the half's top.
    [ROT90, { top: [1839, 310], tl: [1839, 5], br: [5, 615] }],
    // 270: the strip's top edge → the left end; its left edge → the half's bottom.
    [ROT270, { top: [4, 310], tl: [4, 615], br: [1839, 5] }],
  ]) {
    const page = toPrinterNative({ type: 'strip', canvas: markedStrip() }, rot, make);
    for (const half of [0, 620]) {
      assert.deepEqual(px(page, expect.top[0], half + expect.top[1]), RED, `rotation ${rot.strip}: top marker in the half at y=${half}`);
      assert.deepEqual(px(page, expect.tl[0], half + expect.tl[1]), BLUE, `rotation ${rot.strip}: top-left corner in the half at y=${half}`);
      assert.deepEqual(px(page, expect.br[0], half + expect.br[1]), GREEN, `rotation ${rot.strip}: bottom-right corner in the half at y=${half}`);
    }
  }
});

function fakePhoto(w, h) {
  const c = createCanvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = '#888'; g.fillRect(0, 0, w, h);
  return c;
}

/** A strip design rect → where it lands in each native half, for a rotation. */
function stripRectOnPage(r, deg, halfY) {
  // 90 clockwise: (x, y) → (1844 - y, x); 270: (x, y) → (y, 620 - x).
  return deg === 90
    ? { x: 1844 - (r.y + r.h), y: halfY + r.x, w: r.h, h: r.w }
    : { x: r.y, y: halfY + 620 - (r.x + r.w), w: r.h, h: r.w };
}

test('every strip design keeps photos and text >= 20 px from the page edges and the cut at y = 620, at 90 and 270', () => {
  const strips = allFrames().filter(f => f.template === 'strip');
  assert.ok(strips.length > 0, 'there are strip frames');
  const L = stripNativeLayout();
  const photos = [0, 1, 2, 3].map(() => fakePhoto(1920, 1080));
  const card = mintCard({ frameId: strips[0].id, mint: 1 });
  for (const frame of strips) for (const personalization of [null, { name: 'Alexandria Montgomery-Smith' }]) {
    const cv = createCanvas(STRIP_PX.W, STRIP_PX.H);
    const meta = renderStrip(cv.getContext('2d'), { W: STRIP_PX.W, H: STRIP_PX.H, photos, card, frame, personalization });
    assert.ok(meta.contentRects?.length >= 3, `${frame.id}: reports its content`);
    for (const deg of [90, 270]) meta.contentRects.forEach((r, k) => L.halves.forEach((h, i) => {
      const onPage = stripRectOnPage(r, deg, h.y);
      assert.ok(inside(onPage, L.safe[i]),
        `${frame.id}${personalization ? ' (named)' : ''} @${deg}: item ${k} at ${JSON.stringify(onPage)} is outside half ${i + 1}'s safe area`);
    }));
  }
});

test('cards: two upright 750 x 1050 cards (2.5 x 3.5 in), centred, not rotated; on the uncut queue', () => {
  const L = cardSheetLayout(750, 1050);
  assert.equal(L.slots.length, 2);
  for (const s of L.slots) {
    assert.equal(s.w / 300, 2.5); assert.equal(s.h / 300, 3.5);
    assert.ok(inside(s, { x: SAFE_PX, y: SAFE_PX, w: 1844 - 2 * SAFE_PX, h: 1240 - 2 * SAFE_PX }));
  }
  assert.equal(L.slots[0].x, 1844 - (L.slots[1].x + 750), 'centred');
  // A card's short side (750 px) is taller than a 2-inch half (620 px): no card
  // can keep clear of y = 620, which is why cards never go to the cut queue.
  assert.ok(Math.min(750, 1050) > NATIVE.cutY);
  const card = createCanvas(750, 1050);
  const g = card.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 750, 1050);
  g.fillStyle = '#f00'; g.fillRect(0, 0, 10, 10);
  const page = toPrinterNative({ type: 'cards', canvas: card, count: 2 }, ROT270, make);
  for (const s of L.slots) assert.deepEqual(px(page, s.x + 5, s.y + 5), RED, 'upright: the card\'s top-left is still top-left, whatever the strip/4x6 rotations');
});

test('rotation config: 90 or 270 per job, default 90, anything else reported', () => {
  assert.deepEqual(printRotations({}), { portrait4x6: 90, strip: 90, problems: [] });
  assert.deepEqual(printRotations({ rotation: { portrait4x6: 270, strip: '270' } }), { portrait4x6: 270, strip: 270, problems: [] });
  const bad = printRotations({ rotation: { strip: 180 } });
  assert.equal(bad.strip, 90); assert.match(bad.problems[0], /90 or 270/);
  const old = printRotations({ rotation: 270 });
  assert.equal(old.strip, 90); assert.match(old.problems[0], /portrait4x6/);
  assert.deepEqual(PRINT_ROTATIONS, [90, 270]);
});

/* ------------------------------------------------------------ calibration */

test('calibration designs: TOP/LEFT/RIGHT, edge + 20 px borders, then 1844 x 1240 through toPrinterNative', () => {
  for (const [job, d] of Object.entries(CALIBRATION_DESIGN)) {
    const c = createCanvas(d.W, d.H);
    assert.deepEqual(drawCalibration(c.getContext('2d'), { job, rotation: 90 }), { W: d.W, H: d.H });
    assert.deepEqual(px(c, Math.round(d.W / 3), 0), [0, 0, 0], `${job}: top edge`);
    assert.deepEqual(px(c, 0, Math.round(d.H / 3)), [0, 0, 0], `${job}: left edge`);
    assert.deepEqual(px(c, d.W - 1, Math.round(d.H / 3)), [0, 0, 0], `${job}: right edge`);
    assert.deepEqual(px(c, Math.round(d.W / 3), 20), [224, 0, 0], `${job}: red border 20 px in`);
    const page = toPrinterNative({ type: job, canvas: c, count: 2 }, ROT90, make);
    assert.equal(`${page.width}x${page.height}`, '1844x1240', `${job}: native page`);
  }
});

/* ------------------------------------------- Photo Strip Collection */

test('collection: every design renders at print size, 3-4 photo boxes at camera-friendly shapes, content inside the safe area', async () => {
  const { collectionFrames, styledStrip, FORMATS } = await import('../src/js/frames/strips.mjs');
  const { buildPersonal } = await import('../src/js/frames/render.mjs');
  const frames = collectionFrames();
  assert.ok(frames.filter(f => f.format === 'strip').length >= 12 * 2, 'at least 12 designs with variants');
  assert.ok(new Set(frames.filter(f => f.format === 'strip').map(f => f.style)).size >= 12, '12+ distinct strip concepts');
  assert.ok(frames.some(f => f.format === 'jumbo'), 'a Jumbo collection');
  for (const fr of frames) {
    const { W, H } = FORMATS[fr.format];
    for (const personal of [buildPersonal({}), buildPersonal({ name: 'ALEXANDRIA & MAXIMILIAN', age: 30 })]) {
      const cv = createCanvas(W, H);
      const meta = styledStrip(cv.getContext('2d'), { W, H, frame: fr, photos: [], meta: { personal, event: { date: '2026-06-14' } } });
      assert.ok(meta.cells.length >= 3 && meta.cells.length <= 4, `${fr.id}: ${meta.cells.length} photos`);
      for (const c of meta.cells) {
        const a = c.w / c.h;
        assert.ok(a >= 0.75 && a <= 16 / 9 + 1e-6, `${fr.id}: photo box ${c.w.toFixed(0)}x${c.h.toFixed(0)} (aspect ${a.toFixed(2)})`);
        assert.ok(c.w >= W * 0.25, `${fr.id}: photo box ${c.w.toFixed(0)} px wide is too small`);
      }
      assert.ok(Math.max(...meta.cells.map(c => c.w)) >= W * 0.4, `${fr.id}: photos are the main focus`);
      // Every edge of a strip is a page edge or the cut; a Jumbo is a whole page.
      const safe = { x: SAFE_PX, y: SAFE_PX, w: W - 2 * SAFE_PX, h: H - 2 * SAFE_PX };
      meta.contentRects.forEach((r, k) => assert.ok(inside(r, safe), `${fr.id}: item ${k} ${JSON.stringify(r)} outside the safe area`));
    }
  }
});

test('strip print size is 620 x 1844; a Jumbo strip is 1240 x 1844 (a portrait 4x6)', () => {
  assert.deepEqual([printSize('strip', 300).W, printSize('strip', 300).H], [620, 1844]);
  assert.deepEqual([printSize('jumbo', 300).W, printSize('jumbo', 300).H], [1240, 1844]);
});

/* ------------------------------------------------------------------ CUPS */

test('CUPS: only the native landscape page, sent landscape (Gutenprint frame), no fit-to-page', async () => {
  const { jpegToPdf, printImage } = await import('../pi/print.mjs');
  const native = createCanvas(1844, 1240).toBuffer('image/jpeg');
  const portrait = createCanvas(1240, 1844).toBuffer('image/jpeg');
  assert.ok(jpegToPdf(native).pdf.length > 0);
  assert.equal(jpegToPdf(native).pageWpt, 442.56);
  assert.throws(() => jpegToPdf(portrait), /native landscape/);
  const r = await printImage({ jpeg: native, kind: 'strip', printerName: 'X', dryRun: true, options: { PageSize: { choices: ['w288h432', 'w288h432-div2'] } } });
  assert.match(r.command, /-o orientation-requested=4 /);
  assert.match(r.command, /PageSize=w288h432-div2/);
  assert.doesNotMatch(r.command, /fit-to-page|auto-rotate|orientation-requested=[^4]/);
  assert.equal(r.pdfPage, '442.56x297.6pt');
  const bad = await printImage({ jpeg: portrait, kind: '4x6', dryRun: true, options: {} });
  assert.equal(bad.ok, false);
});
