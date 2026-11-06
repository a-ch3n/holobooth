/**
 * engine.mjs — formats, photo arrangement, and the stripDesign template.
 *
 * A strip design is three independent choices:
 *
 *   format   the physical product: 'strip' (2x6, two-up on 4x6 media, cut)
 *            or 'jumbo' (a full 4x6 portrait sheet, no cut)
 *   style    one of the concepts in styles-*.mjs — typography, ornament,
 *            photo treatment, where text lives
 *   palette  one of that style's colourways
 *
 * …plus a shot count (3, 4 or 5). Styles never hard-code pixel geometry;
 * they carve the sheet into header / photos / footer regions in inches and
 * hand the photo region to arrange(), which returns booth-proportioned slots.
 * Adding a style is one object; adding a palette is one line; adding a
 * format is one entry here.
 */

import { units, TONES, setMinType } from './kit.mjs';

export const FORMATS = {
  strip: { id: 'strip', name: 'Classic Strip', widthIn: 2, heightIn: 6, shots: [3, 4] },
  jumbo: { id: 'jumbo', name: 'Jumbo Strip', widthIn: 4, heightIn: 6, shots: [3, 4, 5] },
};

/* ----------------------------------------------------------- arrangement */

/**
 * Booth photos are landscape captures (3:2 / 16:9). Slots are kept inside an
 * aspect range so a crop never cuts someone at the edge of a group out of
 * frame: a 2x2 grid goes no narrower than ~square, a stack no wider than
 * cinema.
 */
export function stack(region, n, { gap, minA = 1.2, maxA = 1.8, align = 'center' } = {}) {
  let h = (region.h - gap * (n - 1)) / n;
  let w = region.w;
  if (w / h > maxA) w = h * maxA;
  if (w / h < minA) h = w / minA;
  const total = n * h + (n - 1) * gap;
  const y0 = region.y + (region.h - total) / 2;
  const x = align === 'left' ? region.x : align === 'right' ? region.x + region.w - w : region.x + (region.w - w) / 2;
  return Array.from({ length: n }, (_, i) => ({ x, y: y0 + i * (h + gap), w, h, i }));
}

export function grid(region, cols, rows, { gap, minA = 0.95, maxA = 1.6 } = {}) {
  let w = (region.w - gap * (cols - 1)) / cols;
  let h = (region.h - gap * (rows - 1)) / rows;
  if (w / h > maxA) w = h * maxA;
  if (w / h < minA) h = w / minA;
  const tw = cols * w + (cols - 1) * gap, th = rows * h + (rows - 1) * gap;
  const x0 = region.x + (region.w - tw) / 2, y0 = region.y + (region.h - th) / 2;
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ x: x0 + c * (w + gap), y: y0 + r * (h + gap), w, h, i: out.length });
  return out;
}

/** One big frame, the rest beneath it (a row of up to 3, or a 2x2 for 4). */
export function hero(region, n, { gap, heroA = 1.5 } = {}) {
  const rest = n - 1;
  const cols = rest === 4 ? 2 : rest;
  const rows = rest === 4 ? 2 : 1;
  // the hero takes what it needs up to ~58% of the height; the rest share the remainder
  const hh = Math.min(region.w / heroA, (region.h - gap) * 0.58);
  // never wider than cinema: a short region narrows the hero rather than flattening it
  const hw = Math.min(region.w, hh * 1.9);
  const top = { x: region.x + (region.w - hw) / 2, y: region.y, w: hw, h: hh, i: 0 };
  const sub = grid({ x: region.x, y: region.y + hh + gap, w: region.w, h: region.h - hh - gap }, cols, rows, { gap, minA: 1.0, maxA: 1.7 });
  sub.forEach((s, k) => { s.i = k + 1; });
  return [top, ...sub];
}

/** The default arrangement for a format and shot count. Styles may override. */
export function arrange(format, region, n, gap, o = {}) {
  if (format === 'strip') return stack(region, n, { gap, minA: o.minA ?? 1.2, maxA: o.maxA ?? 1.75 });
  if (n === 3) return stack(region, 3, { gap, minA: 1.3, maxA: o.maxA ?? 1.95 });
  if (n === 4) return grid(region, 2, 2, { gap, minA: o.minA ?? 0.95, maxA: 1.5 });
  return hero(region, n, { gap, heroA: o.heroA ?? 1.5 });
}

export function bounds(slots) {
  const x0 = Math.min(...slots.map(s => s.x)), y0 = Math.min(...slots.map(s => s.y));
  const x1 = Math.max(...slots.map(s => s.x + s.w)), y1 = Math.max(...slots.map(s => s.y + s.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/* ------------------------------------------------------------------ text */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const p2 = v => String(v).padStart(2, '0');

/** Every date format a design might want, from one Date. US order by default. */
export function dateFormats(d) {
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  return {
    dots: `${p2(m)}.${p2(day)}.${y}`,
    short: `${p2(m)}.${p2(day)}.${String(y).slice(2)}`,
    spaced: `${p2(m)} · ${p2(day)} · ${y}`,
    long: `${MONTHS[m - 1]} ${day}, ${y}`,
    month: `${MONTHS[m - 1]} ${y}`,
    mon: `${MONTHS[m - 1].slice(0, 3)} ${day} ${y}`,
    iso: `${y}.${p2(m)}.${p2(day)}`,
    stamp: `'${String(y).slice(2)} ${p2(m)} ${p2(day)}`,
    roman: `${p2(day)} . ${p2(m)} . ${y}`,
    issue: `${MONTHS[m - 1]} ${y}`,
    year: String(y),
    day, m, y,
  };
}

/**
 * Text a design can draw, resolved once:
 *   name     what the customer typed (empty when they typed nothing)
 *   event    the event title the operator set (e.g. "Maya & Jules")
 *   message  the operator's line (e.g. "Thank you for celebrating with us")
 *   headline name, else event, else the style's own default
 */
export function resolveText(meta, style) {
  const p = meta.personal || {};
  const ev = meta.event || {};
  const name = p.provided ? String(p.name || '').trim() : '';
  const event = String(ev.title || '').trim();
  const d = new Date(ev.date ? ev.date + 'T12:00:00' : (meta.mintedAt || Date.now()));
  return {
    name, event,
    message: String(ev.message || '').trim(),
    headline: name || event || style.defaultHeadline || '',
    age: p.age != null && p.age !== '' && Number.isFinite(Number(p.age)) ? Number(p.age) : null,
    logo: meta.eventLogo || null,
    date: dateFormats(d),
    serial: meta.serial && meta.serial !== '—' ? meta.serial : '',
  };
}

/* --------------------------------------------------------------- template */

let STYLES = {};
export function registerStyles(map) { STYLES = { ...STYLES, ...map }; }
export function styleById(id) { return STYLES[id] || null; }
export function allStyles() { return Object.values(STYLES); }

/**
 * TEMPLATES.stripDesign — called by renderCard() like any other template.
 * Reads frame.design = { style, palette, format, shots }.
 */
export function stripDesign(ctx, o) {
  const { W, H, frame, photos = [], photo, meta } = o;
  const d = frame.design || {};
  const style = STYLES[d.style];
  if (!style) throw new Error(`Unknown strip style: ${d.style}`);
  const format = FORMATS[d.format] ? d.format : 'strip';
  const pal = { ...(style.palettes[d.palette] || Object.values(style.palettes)[0]), ...(d.paletteOverride || {}) };
  const n = d.shots || style.shots?.[format] || 4;
  const shots = photos.length ? photos : (photo ? [photo] : []);
  const { u, pt, ppi } = units(W, FORMATS[format].widthIn);
  const T = resolveText(meta, style);
  const slots = [];

  const env = {
    ctx, W, H, u, pt, ppi, format, jumbo: format === 'jumbo', n, pal, T, meta,
    seed: (meta.seed || 7) >>> 0,
    focal: meta.focal || { x: 0.5, y: 0.42 },
    img: i => shots.length ? shots[i % shots.length] : null,
    arrange: (region, gap, opts) => arrange(format, region, n, gap, opts),
    /** register a slot so stickers know where the photos are */
    track: s => { slots.push(s); return s; },
    tone: pal.tone && TONES[pal.tone] ? pal.tone : null,
  };

  ctx.save();
  setMinType(pt(6));
  try { style.draw(env); } finally { setMinType(0); }
  ctx.restore();

  if (slots.length) {
    const b = bounds(slots);
    meta.artWindow = { ...b, r: 0 };
    meta.photoSlots = slots.map(s => ({ x: s.x, y: s.y, w: s.w, h: s.h }));
  }
}
