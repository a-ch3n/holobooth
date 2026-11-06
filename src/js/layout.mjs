/**
 * layout.mjs — print geometry and crop maths, with no DOM in it.
 *
 * Shared by the kiosk (preview crop guide, final composites, test prints) and
 * by the unit tests (test/layout.test.mjs), so what the tests check is what
 * prints.
 *
 * DNP DS40, 300 dpi, 6x4 media. Its printable 6x4 area, bleed included, is
 * 1844 x 1240 px (Gutenprint's PPD: ImageableArea 297.6 x 442.56 pt). Every
 * page is built at exactly that size so nothing downstream rescales it.
 */

export const DS40 = { long: 1844, short: 1240, dpi: 300 };

/** Keep important content this far from every strip edge and the cut line. */
export const SAFE_PX = 20;

/** The 4x6 page in pixels: 1844 x 1240 landscape or 1240 x 1844 portrait. */
export function pageSize(orientation = 'landscape', media = DS40) {
  return orientation === 'portrait'
    ? { W: media.short, H: media.long }
    : { W: media.long, H: media.short };
}

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

/**
 * Two 2x6 strips on one portrait 4x6 page: 1240 x 1844, each strip
 * 620 x 1844, side by side. The DS40's 2-inch cut (PageSize w288h432-div2, or
 * the "2inch cut" driver setting on Windows) cuts at x = 620.
 */
export function stripPageLayout(media = DS40, safe = SAFE_PX) {
  const { W, H } = pageSize('portrait', media);
  const sw = W / 2;
  const strips = [0, 1].map(i => ({ x: i * sw, y: 0, w: sw, h: H }));
  return {
    W, H, cutX: sw,
    strips,
    safe: strips.map(s => ({ x: s.x + safe, y: s.y + safe, w: s.w - safe * 2, h: s.h - safe * 2 })),
    unit: { W: sw, H },
  };
}

/** The strip itself (one of the two): 620 x 1844. */
export const STRIP_PX = { W: DS40.short / 2, H: DS40.long };

/**
 * Trading cards (750 x 1050 at 300 dpi) on a landscape 4x6 page: two side
 * by side, centred, cut out by hand along the cut marks.
 */
export function cardSheetLayout(unitW, unitH, media = DS40) {
  const { W, H } = pageSize('landscape', media);
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

/* ------------------------------------------------------------- compose */

/** Draw the strip twice on the 1240 x 1844 page, pixel for pixel (no scaling). */
export function composeStripPage(ctx, strip, media = DS40) {
  const L = stripPageLayout(media);
  if (strip.width !== L.unit.W || strip.height !== L.unit.H) {
    throw new Error(`Strip must be ${L.unit.W}x${L.unit.H} px, got ${strip.width}x${strip.height}`);
  }
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, L.W, L.H);
  for (const s of L.strips) ctx.drawImage(strip, s.x, s.y);
  return L;
}

/** Cards onto 1844 x 1240 pages; returns how many cards each page holds. */
export function composeCardSheet(ctx, card, count, media = DS40) {
  const L = cardSheetLayout(card.width, card.height, media);
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

/**
 * The test-print image. A 1 px black border on the very edge pixels, a red
 * border SAFE_PX inside it, ruler ticks every 10 px (long every 50) along all
 * four edges, and the page's pixel size as text. For strips: the cut line in
 * blue and each strip's own safe border.
 *
 * Reading it: if the black edge line is missing on a side, the printer crops
 * there; the ticks say by how much. If the red line is missing, important
 * content would be lost. If the text size or the 10 px ticks measure wrong,
 * something scaled the page.
 */
export function drawCalibration(ctx, { kind = '4x6', orientation = 'landscape', media = DS40, label = '' } = {}) {
  const strip = kind === 'strip';
  const { W, H } = strip ? pageSize('portrait', media) : pageSize(orientation, media);
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

  // 1 px border on the outermost pixels.
  ctx.fillRect(0, 0, W, 1); ctx.fillRect(0, H - 1, W, 1);
  ctx.fillRect(0, 0, 1, H); ctx.fillRect(W - 1, 0, 1, H);

  // Safe border, SAFE_PX in.
  const box = (x, y, w, h, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1);
    ctx.fillRect(x, y, 1, h); ctx.fillRect(x + w - 1, y, 1, h);
  };
  const lines = [];
  if (strip) {
    const L = stripPageLayout(media);
    L.safe.forEach(s => box(s.x, s.y, s.w, s.h, '#e00000'));
    // The cut line: solid 1 px at x = cutX, with arrows above and below.
    ctx.fillStyle = '#0050ff';
    ctx.fillRect(L.cutX, 0, 1, H);
    for (const y of [40, H - 40]) {
      ctx.beginPath();
      ctx.moveTo(L.cutX - 18, y - (y < H / 2 ? 18 : -18)); ctx.lineTo(L.cutX + 18, y - (y < H / 2 ? 18 : -18)); ctx.lineTo(L.cutX, y);
      ctx.closePath(); ctx.fill();
    }
    lines.push(`${W} x ${H} px`, 'two strips', `${L.unit.W} x ${L.unit.H} each`, `cut at x = ${L.cutX}`);
  } else {
    box(SAFE_PX, SAFE_PX, W - SAFE_PX * 2, H - SAFE_PX * 2, '#e00000');
    lines.push(`${W} x ${H} px`, `${orientation} 4x6`);
  }
  lines.push(`black = edge pixel`, `red = ${SAFE_PX} px inside`);
  if (label) lines.push(label);

  // Text, centred in each strip (or the page), "TOP" first.
  const columns = strip ? stripPageLayout(media).strips : [{ x: 0, y: 0, w: W, h: H }];
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const col of columns) {
    const big = Math.round(Math.min(col.w, col.h) * 0.11);
    const small = Math.round(big * 0.42);
    const cx = col.x + col.w / 2;
    ctx.font = `bold ${big}px sans-serif`;
    ctx.fillText('▲ TOP', cx, col.y + col.h * 0.14);
    ctx.font = `${small}px sans-serif`;
    const y0 = col.y + col.h / 2 - (lines.length - 1) * small * 0.75;
    lines.forEach((t, i) => ctx.fillText(t, cx, y0 + i * small * 1.5));
  }
  ctx.restore();
  return { W, H };
}
