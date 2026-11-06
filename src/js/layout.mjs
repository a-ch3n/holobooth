/**
 * layout.mjs — print geometry and crop maths, with no DOM in it.
 *
 * Shared by the kiosk (preview crop guide, final composites, test prints) and
 * by the unit tests (test/layout.test.mjs), so what the tests check is what
 * prints.
 *
 * DNP DS40, 300 dpi, 6x4 media. Its native page is 6x4 LANDSCAPE, bleed
 * included: 1844 x 1240 px, with the 2-inch cut at y = 620. Every print job
 * is turned into exactly that page by toPrinterNative() (below), the only
 * place in the print path that rotates anything.
 */

/** Keep important content this far from every strip edge and the cut line. */
export const SAFE_PX = 20;

/**
 * Centre crop ("cover"): the largest rectangle of the source with the
 * destination's aspect ratio, centred (or at focal). Never stretches: the
 * result always has exactly dstW/dstH's shape, so drawing it into dst scales
 * both axes by the same factor.
 * @returns {{sx:number, sy:number, sw:number, sh:number, scale:number}}
 */
export function coverCrop(srcW, srcH, dstW, dstH, focal = { x: 0.5, y: 0.5 }) {
  if (!(srcW > 0 && srcH > 0 && dstW > 0 && dstH > 0)) return { sx: 0, sy: 0, sw: srcW || 0, sh: srcH || 0, scale: 1 };
  const aspect = dstW / dstH;
  let sw, sh;
  if (srcW / srcH > aspect) { sh = srcH; sw = srcH * aspect; } // source wider: trim the sides
  else { sw = srcW; sh = srcW / aspect; }                       // source taller: trim top/bottom
  const fx = Math.min(1, Math.max(0, focal?.x ?? 0.5));
  const fy = Math.min(1, Math.max(0, focal?.y ?? 0.5));
  return { sx: (srcW - sw) * fx, sy: (srcH - sh) * fy, sw, sh, scale: dstW / sw };
}

/**
 * Where a cover-fitted source lands on screen (CSS object-fit: cover,
 * object-position: center): the displayed size and offset of the whole frame.
 */
export function coverPlacement(srcW, srcH, boxW, boxH) {
  const scale = Math.max(boxW / srcW, boxH / srcH);
  const w = srcW * scale, h = srcH * scale;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h, scale };
}

/** The strip itself, as designed (portrait): 620 x 1844. */
export const STRIP_PX = { W: 620, H: 1844 };

/**
 * Trading cards (750 x 1050 at 300 dpi), upright, two side by side on the
 * native 1844 x 1240 page, centred, cut out by hand along the cut marks.
 * A 2.5 in card is taller than a 2-inch half, so card sheets always cross
 * y = 620 and always print on the uncut queue.
 */
export function cardSheetLayout(unitW, unitH) {
  const { W, H } = NATIVE;
  const cols = Math.max(1, Math.floor(W / unitW));
  const rows = Math.max(1, Math.floor(H / unitH));
  const x0 = Math.round((W - cols * unitW) / 2);
  const y0 = Math.round((H - rows * unitH) / 2);
  const slots = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) slots.push({ x: x0 + c * unitW, y: y0 + r * unitH, w: unitW, h: unitH });
  return { W, H, cols, rows, slots, x0, y0, unitW, unitH };
}

/** True when rect lies entirely inside box (both {x,y,w,h}). */
export function inside(rect, box) {
  const e = 1e-6;
  return rect.x >= box.x - e && rect.y >= box.y - e &&
    rect.x + rect.w <= box.x + box.w + e && rect.y + rect.h <= box.y + box.h + e;
}

/* ================================================= printer-native page */

/**
 * The DNP DS40 prints on 6-inch-wide media. Its native page is 6 x 4 in
 * LANDSCAPE: 1844 x 1240 px at 300 dpi. The 2-inch cut is the horizontal
 * line y = 620 (top half / bottom half). Every job reaches the printer as
 * one page in exactly this layout.
 */
export const NATIVE = { W: 1844, H: 1240, cutY: 620 };

/** Strips on the native page: two 1844 x 620 halves, cut at y = 620. */
export function stripNativeLayout(safe = SAFE_PX) {
  const halves = [0, 1].map(i => ({ x: 0, y: i * NATIVE.cutY, w: NATIVE.W, h: NATIVE.cutY }));
  return {
    W: NATIVE.W, H: NATIVE.H, cutY: NATIVE.cutY, halves,
    safe: halves.map(h => ({ x: h.x + safe, y: h.y + safe, w: h.w - 2 * safe, h: h.h - 2 * safe })),
  };
}

/** Allowed values for printer.rotation.portrait4x6 and printer.rotation.strip. */
export const PRINT_ROTATIONS = [90, 270];

/**
 * printer.rotation from the config: { portrait4x6, strip }, each 90 or 270
 * (default 90). Anything else is reported in `problems` and the default used.
 */
export function printRotations(printer = {}) {
  const r = printer?.rotation;
  const out = { portrait4x6: 90, strip: 90, problems: [] };
  if (r == null) return out;
  if (typeof r !== 'object') { out.problems.push(`printer.rotation is now { "portrait4x6": 90, "strip": 90 }, not ${JSON.stringify(r)}; using 90 for both`); return out; }
  for (const key of ['portrait4x6', 'strip']) {
    if (r[key] == null) continue;
    const v = Number(r[key]);
    if (PRINT_ROTATIONS.includes(v)) out[key] = v;
    else out.problems.push(`printer.rotation.${key} must be 90 or 270 (it is ${JSON.stringify(r[key])}); using 90`);
  }
  return out;
}

/**
 * The only rotation in the print path: the canvas turned clockwise by 90 or
 * 270 degrees. Width and height swap; translate, rotate, draw.
 */
function rotateCanvas(src, deg, makeCanvas) {
  if (!PRINT_ROTATIONS.includes(deg)) throw new Error(`rotation must be 90 or 270, not ${deg}`);
  const out = makeCanvas(src.height, src.width);
  const ctx = out.getContext('2d');
  if (deg === 90) { ctx.translate(out.width, 0); ctx.rotate(Math.PI / 2); }
  else { ctx.translate(0, out.height); ctx.rotate(-Math.PI / 2); }
  ctx.drawImage(src, 0, 0);
  return out;
}

function whitePage(makeCanvas) {
  const page = makeCanvas(NATIVE.W, NATIVE.H);
  const ctx = page.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, NATIVE.W, NATIVE.H);
  return { page, ctx };
}

/**
 * Every print job → ONE 1844 x 1240 page in the DS40's native layout.
 *
 *   { type: '4x6', canvas }          1844 x 1240: used as is.
 *                                    1240 x 1844 (e.g. a Jumbo strip): turned by rotation.portrait4x6.
 *   { type: 'strip', canvas }        the 620 x 1844 strip: turned by rotation.strip to 1844 x 620,
 *                                    copy 1 at y = 0, copy 2 at y = 620 (the 2-inch cut).
 *   { type: 'cards', canvas, count } one 750 x 1050 card, upright, count (1 or 2) side by side.
 *                                    Not turned; cut by hand; never sent to the cut queue.
 *
 * @param {{type:'4x6'|'strip'|'cards', canvas:any, count?:number}} job
 * @param {{portrait4x6:number, strip:number}} rotation  from printRotations()
 * @param {(w:number,h:number)=>any} makeCanvas
 */
export function toPrinterNative(job, rotation, makeCanvas) {
  const src = job.canvas;
  if (job.type === '4x6') {
    if (src.width === NATIVE.W && src.height === NATIVE.H) return src;
    if (src.width === NATIVE.H && src.height === NATIVE.W) return rotateCanvas(src, rotation.portrait4x6, makeCanvas);
    throw new Error(`A 4x6 page must be 1844x1240 or 1240x1844, got ${src.width}x${src.height}`);
  }
  if (job.type === 'strip') {
    if (src.width !== STRIP_PX.W || src.height !== STRIP_PX.H) throw new Error(`A strip must be ${STRIP_PX.W}x${STRIP_PX.H}, got ${src.width}x${src.height}`);
    const turned = rotateCanvas(src, rotation.strip, makeCanvas);
    const { page, ctx } = whitePage(makeCanvas);
    for (const h of stripNativeLayout().halves) ctx.drawImage(turned, h.x, h.y);
    return page;
  }
  if (job.type === 'cards') {
    const { page, ctx } = whitePage(makeCanvas);
    composeCardSheet(ctx, src, job.count || 1);
    return page;
  }
  throw new Error(`Unknown print job type "${job.type}"`);
}

/** Cards onto the native page, upright; returns how many it holds. */
export function composeCardSheet(ctx, card, count) {
  const L = cardSheetLayout(card.width, card.height);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, L.W, L.H);
  const n = Math.min(count, L.slots.length);
  for (let i = 0; i < n; i++) ctx.drawImage(card, L.slots[i].x, L.slots[i].y);
  drawCutMarks(ctx, L);
  return n;
}

/** Short grey ticks at every card boundary, out at the page edges. */
function drawCutMarks(ctx, L) {
  const tick = Math.round(L.W * 0.02);
  ctx.save();
  ctx.strokeStyle = '#c4c4c4';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let c = 0; c <= L.cols; c++) {
    const x = L.x0 + c * L.unitW;
    ctx.moveTo(x, 0); ctx.lineTo(x, Math.min(tick, L.y0));
    ctx.moveTo(x, L.H - Math.min(tick, L.y0)); ctx.lineTo(x, L.H);
  }
  for (let r = 0; r <= L.rows; r++) {
    const y = L.y0 + r * L.unitH;
    ctx.moveTo(0, y); ctx.lineTo(Math.min(tick, L.x0), y);
    ctx.moveTo(L.W - Math.min(tick, L.x0), y); ctx.lineTo(L.W, y);
  }
  ctx.stroke();
  ctx.restore();
}

/* --------------------------------------------------------- calibration */

/** Each test print's design, in its own design orientation, before toPrinterNative. */
export const CALIBRATION_DESIGN = {
  '4x6': { W: 1240, H: 1844, name: '4x6 portrait (Jumbo)', rotationKey: 'portrait4x6' },
  strip: { W: 620, H: 1844, name: 'photo strip', rotationKey: 'strip' },
  cards: { W: 750, H: 1050, name: 'trading card', rotationKey: null },
};

/**
 * The test-print design for a job type, drawn in its DESIGN orientation (it
 * then goes through toPrinterNative like a real job):
 *   - a big "TOP ↑" at the top, "LEFT" and "RIGHT" on the sides
 *   - a 1 px black border on the very edge pixels, a red one SAFE_PX inside
 *   - ruler ticks every 10 px along the edges
 *   - strips and cards: where the cut falls, as a dashed blue line
 *   - the job type and its rotation value
 */
export function drawCalibration(ctx, { job = '4x6', rotation = null, label = '' } = {}) {
  const d = CALIBRATION_DESIGN[job];
  if (!d) throw new Error(`Unknown test print "${job}"`);
  const { W, H } = d;
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // Ruler ticks along every edge.
  ctx.fillStyle = '#000';
  for (let x = 0; x <= W; x += 10) {
    const len = x % 50 === 0 ? 14 : 6;
    ctx.fillRect(Math.min(x, W - 1), 0, 1, len);
    ctx.fillRect(Math.min(x, W - 1), H - len, 1, len);
  }
  for (let y = 0; y <= H; y += 10) {
    const len = y % 50 === 0 ? 14 : 6;
    ctx.fillRect(0, Math.min(y, H - 1), len, 1);
    ctx.fillRect(W - len, Math.min(y, H - 1), len, 1);
  }
  // 1 px border on the outermost pixels, and the safe border SAFE_PX in.
  ctx.fillRect(0, 0, W, 1); ctx.fillRect(0, H - 1, W, 1);
  ctx.fillRect(0, 0, 1, H); ctx.fillRect(W - 1, 0, 1, H);
  ctx.fillStyle = '#e00000';
  ctx.fillRect(SAFE_PX, SAFE_PX, W - 2 * SAFE_PX, 1); ctx.fillRect(SAFE_PX, H - SAFE_PX - 1, W - 2 * SAFE_PX, 1);
  ctx.fillRect(SAFE_PX, SAFE_PX, 1, H - 2 * SAFE_PX); ctx.fillRect(W - SAFE_PX - 1, SAFE_PX, 1, H - 2 * SAFE_PX);

  // Where the cut falls, dashed: a strip's long edges (one of them is the
  // printer's 2-inch cut, the other the paper edge); a card's outline (cut by hand).
  ctx.strokeStyle = '#0050ff';
  ctx.lineWidth = 3;
  ctx.setLineDash([18, 12]);
  ctx.beginPath();
  if (job === 'strip') { ctx.moveTo(8.5, 0); ctx.lineTo(8.5, H); ctx.moveTo(W - 8.5, 0); ctx.lineTo(W - 8.5, H); }
  if (job === 'cards') ctx.rect(8.5, 8.5, W - 17, H - 17);
  ctx.stroke();
  ctx.setLineDash([]);

  // Labels.
  const big = Math.round(Math.min(W, H) * 0.14);
  const small = Math.max(22, Math.round(big * 0.3));
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${big}px sans-serif`;
  ctx.fillText('TOP ↑', W / 2, SAFE_PX + 30 + big * 0.55);
  ctx.font = `bold ${small}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText('LEFT', SAFE_PX + 18, H / 2);
  ctx.textAlign = 'right';
  ctx.fillText('RIGHT', W - SAFE_PX - 18, H / 2);
  ctx.textAlign = 'center';
  ctx.font = `${small}px sans-serif`;
  const rot = d.rotationKey ? `rotation.${d.rotationKey} = ${rotation ?? '?'}` : 'not rotated (upright, 2 per sheet)';
  const lines = [`TEST: ${d.name}`, `${W} x ${H} px design`, rot,
    job === 'strip' ? 'blue dashes = cut / paper edge' : job === 'cards' ? 'blue dashes = cut by hand' : 'no cut',
    `black = edge, red = ${SAFE_PX} px in`];
  if (label) lines.push(label);
  const y0 = H / 2 + small * 2.2;
  lines.forEach((t, i) => ctx.fillText(t, W / 2, y0 + i * small * 1.45, W - 2 * SAFE_PX - 40));
  ctx.restore();
  return { W, H };
}
