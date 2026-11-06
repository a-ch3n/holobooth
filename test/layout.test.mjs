/**
 * Unit tests for the print geometry and crop maths (src/js/layout.mjs) and
 * for the strip template's safe area. Run: npm run test:unit
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import {
  DS40, SAFE_PX, STRIP_PX, pageSize, coverCrop, coverPlacement, stripPageLayout,
  cardSheetLayout, inside, composeStripPage, composeCardSheet, drawCalibration,
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

test('DS40 4x6 page is 1844 x 1240 landscape / 1240 x 1844 portrait', () => {
  assert.deepEqual(pageSize('landscape'), { W: 1844, H: 1240 });
  assert.deepEqual(pageSize('portrait'), { W: 1240, H: 1844 });
});

test('strip page: two 620 x 1844 strips side by side on 1240 x 1844, cut at x = 620', () => {
  const L = stripPageLayout();
  assert.equal(L.W, 1240); assert.equal(L.H, 1844);
  assert.equal(L.cutX, 620);
  assert.deepEqual(L.strips, [{ x: 0, y: 0, w: 620, h: 1844 }, { x: 620, y: 0, w: 620, h: 1844 }]);
  assert.deepEqual(STRIP_PX, { W: 620, H: 1844 });
  // Safe areas: SAFE_PX from every page edge AND from the cut line.
  for (const s of L.safe) {
    assert.ok(s.x >= SAFE_PX && s.y >= SAFE_PX && s.x + s.w <= L.W - SAFE_PX && s.y + s.h <= L.H - SAFE_PX, 'away from the page edges');
    assert.ok(s.x + s.w <= L.cutX - SAFE_PX || s.x >= L.cutX + SAFE_PX, 'away from the cut line');
  }
});

test('strip print size from the renderer is exactly 620 x 1844', () => {
  const s = printSize('strip', 300);
  assert.equal(s.W, 620); assert.equal(s.H, 1844);
});

test('composeStripPage puts the strip twice, pixel for pixel, with nothing scaled', () => {
  const strip = createCanvas(620, 1844);
  const sctx = strip.getContext('2d');
  sctx.fillStyle = '#ff0000'; sctx.fillRect(0, 0, 620, 1844);
  sctx.fillStyle = '#0000ff'; sctx.fillRect(0, 0, 1, 1);          // marker on the strip's first pixel
  sctx.fillStyle = '#00ff00'; sctx.fillRect(619, 1843, 1, 1);     // and its last
  const page = createCanvas(1240, 1844);
  const ctx = page.getContext('2d');
  composeStripPage(ctx, strip);
  const px = (x, y) => [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)];
  assert.deepEqual(px(0, 0), [0, 0, 255]);
  assert.deepEqual(px(619, 1843), [0, 255, 0]);
  assert.deepEqual(px(620, 0), [0, 0, 255], 'second strip starts exactly at the cut line');
  assert.deepEqual(px(1239, 1843), [0, 255, 0]);
  assert.throws(() => composeStripPage(ctx, createCanvas(600, 1800)), /620x1844/);
});

test('card sheet: two 750 x 1050 cards centred on 1844 x 1240', () => {
  const L = cardSheetLayout(750, 1050);
  assert.equal(L.W, 1844); assert.equal(L.H, 1240);
  assert.equal(L.slots.length, 2);
  for (const s of L.slots) assert.ok(inside(s, { x: SAFE_PX, y: SAFE_PX, w: L.W - 2 * SAFE_PX, h: L.H - 2 * SAFE_PX }));
  assert.equal(L.slots[0].x, L.W - (L.slots[1].x + 750), 'centred');
  const page = createCanvas(L.W, L.H);
  assert.equal(composeCardSheet(page.getContext('2d'), createCanvas(750, 1050), 5), 2);
});

/* -------------------------------------------- strip content vs safe area */

function fakePhoto(w, h) {
  const c = createCanvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = '#888'; g.fillRect(0, 0, w, h);
  return c;
}

test('every strip frame keeps photos and text >= 20 px from the strip edges and the cut line', () => {
  const strips = allFrames().filter(f => f.template === 'strip');
  assert.ok(strips.length > 0, 'there are strip frames');
  const L = stripPageLayout();
  const photos = [0, 1, 2, 3].map(() => fakePhoto(1920, 1080));
  const card = mintCard({ frameId: strips[0].id, mint: 1 });
  for (const frame of strips) for (const personalization of [null, { name: 'Alexandria Montgomery-Smith' }]) {
    const cv = createCanvas(STRIP_PX.W, STRIP_PX.H);
    const meta = renderStrip(cv.getContext('2d'), { W: STRIP_PX.W, H: STRIP_PX.H, photos, card, frame, personalization });
    assert.ok(meta.contentRects?.length >= 3, `${frame.id}: reports its content`);
    // The same strip appears at both positions on the page.
    meta.contentRects.forEach((r, k) => L.strips.forEach((s, i) => {
      const onPage = { x: r.x + s.x, y: r.y + s.y, w: r.w, h: r.h };
      assert.ok(inside(onPage, L.safe[i]),
        `${frame.id}${personalization ? ' (named)' : ''}: item ${k} at ${JSON.stringify(onPage)} is outside strip ${i + 1}'s safe area ${JSON.stringify(L.safe[i])}`);
    }));
  }
});

/* ------------------------------------------------------------ calibration */

test('calibration image: edge pixels black, red border 20 px in, cut line marked at 620', () => {
  const page = createCanvas(1240, 1844);
  const ctx = page.getContext('2d');
  const size = drawCalibration(ctx, { kind: 'strip' });
  assert.deepEqual(size, { W: 1240, H: 1844 });
  const px = (x, y) => [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)];
  assert.deepEqual(px(300, 0), [0, 0, 0], 'top edge');
  assert.deepEqual(px(300, 1843), [0, 0, 0], 'bottom edge');
  assert.deepEqual(px(0, 900), [0, 0, 0], 'left edge');
  assert.deepEqual(px(1239, 900), [0, 0, 0], 'right edge');
  assert.deepEqual(px(300, 20), [224, 0, 0], 'safe border, top');
  assert.deepEqual(px(20, 900), [224, 0, 0], 'safe border, left');
  assert.deepEqual(px(599, 900), [224, 0, 0], 'safe border before the cut');
  assert.deepEqual(px(640, 900), [224, 0, 0], 'safe border after the cut');
  assert.deepEqual(px(620, 900), [0, 80, 255], 'cut line');
  const four = createCanvas(1844, 1240);
  assert.deepEqual(drawCalibration(four.getContext('2d'), { kind: '4x6', orientation: 'landscape' }), { W: 1844, H: 1240 });
  assert.deepEqual([...four.getContext('2d').getImageData(1843, 600, 1, 1).data.slice(0, 3)], [0, 0, 0]);
  assert.deepEqual([...four.getContext('2d').getImageData(1823, 600, 1, 1).data.slice(0, 3)], [224, 0, 0]);
});

test('DS40 constants', () => {
  assert.deepEqual(DS40, { long: 1844, short: 1240, dpi: 300 });
});
